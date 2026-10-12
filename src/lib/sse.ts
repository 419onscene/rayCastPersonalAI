import { type ReplyDelta } from "./types";

export interface SseEvent {
  event: string;
  data: string;
}

export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: SseEvent[] = [];

  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join("\n") });
  }

  return { events, rest };
}

export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((line) => line.trim()).filter(Boolean), rest };
}

export function deltasFromAnthropic(data: string): ReplyDelta[] {
  const json = parseJson(data);
  if (!json) return [];
  if (json.type === "error") throw new Error(readMessage(json.error) || "Claude returned an error.");
  if (json.type !== "content_block_delta") return [];
  const delta = asRecord(json.delta);
  if (!delta) return [];
  if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
    return [{ kind: "text", text: delta.text }];
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
    return [{ kind: "thinking", text: delta.thinking }];
  }
  return [];
}

export function deltasFromChatChunk(data: string): ReplyDelta[] {
  if (data.trim() === "[DONE]") return [];
  const json = parseJson(data);
  if (!json) return [];
  if (json.error) throw new Error(readMessage(json.error) || "The model returned an error.");
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice = asRecord(choices[0]);
  const delta = asRecord(choice?.delta);
  if (!delta) return [];
  const out: ReplyDelta[] = [];
  const reasoning = firstString(delta.reasoning_content, delta.reasoning);
  if (reasoning) out.push({ kind: "thinking", text: reasoning });
  if (typeof delta.content === "string" && delta.content) out.push({ kind: "text", text: delta.content });
  return out;
}

export function deltasFromResponsesEvent(eventName: string, data: string): ReplyDelta[] {
  if (data.trim() === "[DONE]") return [];
  const json = parseJson(data);
  if (!json) return [];
  if (json.error || json.type === "error" || json.type === "response.failed") {
    throw new Error(readMessage(json.error) || readMessage(json.response) || "Grok returned an error.");
  }
  const type = typeof json.type === "string" ? json.type : eventName;
  if (typeof json.delta !== "string" || !json.delta) return [];
  if (type.includes("reasoning")) return [{ kind: "thinking", text: json.delta }];
  if (type.includes("output_text")) return [{ kind: "text", text: json.delta }];
  return [];
}

export function deltasFromOllama(line: string): ReplyDelta[] {
  const json = parseJson(line);
  if (!json) return [];
  if (json.error) throw new Error(readMessage(json.error) || "Ollama returned an error.");
  const message = asRecord(json.message);
  if (!message) return [];
  const out: ReplyDelta[] = [];
  if (typeof message.thinking === "string" && message.thinking) out.push({ kind: "thinking", text: message.thinking });
  if (typeof message.content === "string" && message.content) out.push({ kind: "text", text: message.content });
  return out;
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function readMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.message === "string") return record.message;
  const nested = asRecord(record.error);
  if (typeof nested?.message === "string") return nested.message;
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}
