import { runAppleShortcut } from "./apple";
import { formatHttpError, formatNetworkError } from "./errors";
import { ollamaApiUrl } from "./ollama";
import {
  deltasFromAnthropic,
  deltasFromChatChunk,
  deltasFromOllama,
  deltasFromResponsesEvent,
  parseSse,
  splitLines,
} from "./sse";
import { outputTokenCap, planThinking } from "./thinking";
import { type ProviderId, PROVIDER_LABEL, type ReplyDelta, type ThinkingLevel } from "./types";

export interface GenerateInput {
  provider: ProviderId;
  model: string;
  thinking: ThinkingLevel;
  prompt: string;
  apiKey: string;
  ollamaBaseUrl: string;
  appleShortcutName: string;
}

export async function generateReply(
  input: GenerateInput,
  handlers: {
    signal: AbortSignal;
    onDelta: (delta: ReplyDelta) => void;
    onNote: (note: string | undefined) => void;
  },
): Promise<void> {
  const plan = planThinking(input.provider, input.model, input.thinking);
  handlers.onNote(plan.note);

  if (input.provider === "apple") {
    const text = await runAppleShortcut(input.appleShortcutName, input.prompt, handlers.signal);
    if (text) handlers.onDelta({ kind: "text", text });
    return;
  }

  if (!input.model.trim()) {
    throw new Error(input.provider === "ollama" ? "Pick an Ollama model, or set a custom model id." : "Pick a model.");
  }

  const keyError = missingKey(input.provider, input.apiKey);
  if (keyError) throw new Error(keyError);

  if (input.provider === "anthropic") {
    const thinking = plan.anthropic?.thinking;
    await streamSse(
      "https://api.anthropic.com/v1/messages",
      {
        "content-type": "application/json",
        "x-api-key": input.apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      {
        model: input.model,
        max_tokens: outputTokenCap(input.thinking),
        stream: true,
        messages: [{ role: "user", content: input.prompt }],
        ...(thinking ? { thinking } : {}),
        ...(plan.anthropic ? { output_config: { effort: plan.anthropic.effort } } : {}),
      },
      handlers,
      PROVIDER_LABEL.anthropic,
      (event) => deltasFromAnthropic(event.data),
    );
    return;
  }

  if (input.provider === "openai") {
    await streamSse(
      "https://api.openai.com/v1/chat/completions",
      {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey.trim()}`,
      },
      {
        model: input.model,
        messages: [{ role: "user", content: input.prompt }],
        stream: true,
        max_completion_tokens: outputTokenCap(input.thinking),
        ...(plan.openaiReasoningEffort ? { reasoning_effort: plan.openaiReasoningEffort } : {}),
      },
      handlers,
      PROVIDER_LABEL.openai,
      (event) => deltasFromChatChunk(event.data),
    );
    return;
  }

  if (input.provider === "xai") {
    await streamSse(
      "https://api.x.ai/v1/responses",
      {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey.trim()}`,
      },
      {
        model: input.model,
        input: input.prompt,
        stream: true,
        ...(plan.xaiReasoningEffort ? { reasoning: { effort: plan.xaiReasoningEffort } } : {}),
      },
      handlers,
      PROVIDER_LABEL.xai,
      (event) => deltasFromResponsesEvent(event.event, event.data),
    );
    return;
  }

  const baseUrl = ollamaApiUrl(input.ollamaBaseUrl, "/api/chat");
  await streamNdjson(
    baseUrl,
    {
      model: input.model,
      messages: [{ role: "user", content: input.prompt }],
      stream: true,
      think: plan.ollamaThink,
    },
    handlers,
    baseUrl,
  );
}

export function missingKey(provider: ProviderId, apiKey: string): string | undefined {
  if (apiKey.trim()) return undefined;
  if (provider === "anthropic") return "Add your Anthropic API key in Raycast extension preferences.";
  if (provider === "openai") return "Add your OpenAI API key in Raycast extension preferences.";
  if (provider === "xai") return "Add your xAI API key in Raycast extension preferences.";
  return undefined;
}

async function streamSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  handlers: { signal: AbortSignal; onDelta: (delta: ReplyDelta) => void },
  providerLabel: string,
  mapEvent: (event: { event: string; data: string }) => ReplyDelta[],
): Promise<void> {
  const response = await request(url, headers, body, handlers.signal, providerLabel);
  let rest = "";
  await readBody(response, handlers.signal, (chunk) => {
    const parsed = parseSse(rest + chunk);
    rest = parsed.rest;
    for (const event of parsed.events) emit(mapEvent(event), handlers.onDelta);
  });
  if (rest.trim()) {
    const parsed = parseSse(`${rest}\n\n`);
    for (const event of parsed.events) emit(mapEvent(event), handlers.onDelta);
  }
}

async function streamNdjson(
  url: string,
  body: unknown,
  handlers: { signal: AbortSignal; onDelta: (delta: ReplyDelta) => void },
  baseUrl: string,
): Promise<void> {
  const response = await request(
    url,
    { "content-type": "application/json" },
    body,
    handlers.signal,
    `Ollama at ${baseUrl}`,
  );
  let rest = "";
  await readBody(response, handlers.signal, (chunk) => {
    const parsed = splitLines(rest + chunk);
    rest = parsed.rest;
    for (const line of parsed.lines) emit(deltasFromOllama(line), handlers.onDelta);
  });
  if (rest.trim()) emit(deltasFromOllama(rest), handlers.onDelta);
}

async function request(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  providerLabel: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(formatNetworkError(error, providerLabel));
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(formatHttpError(response.status, text, providerLabel));
  }
  return response;
}

async function readBody(response: Response, signal: AbortSignal, onChunk: (chunk: string) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The provider returned an empty body.");
  const decoder = new TextDecoder();
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
    if (signal.aborted) await reader.cancel().catch(() => undefined);
  } finally {
    reader.releaseLock();
  }
}

function emit(deltas: ReplyDelta[], onDelta: (delta: ReplyDelta) => void): void {
  for (const delta of deltas) {
    if (delta.text) onDelta(delta);
  }
}
