import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatShortcutError } from "./apple";
import { composePrompt } from "./compose-prompt";
import { chatGptPasteScript, claudeDesktopUrl, CLAUDE_PROMPT_LIMIT, chatgptDesktopUrl } from "./desktop";
import { extractErrorMessage, formatHttpError } from "./errors";
import { buildModelChoices, selectModel } from "./models";
import { normalizeBaseUrl, ollamaApiUrl } from "./ollama";
import { parsePrompts } from "./prompt-json";
import { renderReply } from "./render-reply";
import { deltasFromAnthropic, deltasFromChatChunk, deltasFromOllama, deltasFromResponsesEvent, parseSse } from "./sse";
import { planThinking } from "./thinking";

describe("composePrompt", () => {
  it("appends typed text to a saved template", () => {
    assert.equal(composePrompt("Summarize this:", "the launch notes"), "Summarize this:\n\nthe launch notes");
  });

  it("uses whichever side is present", () => {
    assert.equal(composePrompt("  Only template  ", "  "), "Only template");
    assert.equal(composePrompt(undefined, "  Just typed  "), "Just typed");
  });

  it("returns an empty string when both sides are blank", () => {
    assert.equal(composePrompt("  ", " \n"), "");
  });
});

describe("thinking plans", () => {
  it("keeps always-on Claude models at low effort instead of disabled", () => {
    const plan = planThinking("anthropic", "claude-opus-5-5", "off");
    assert.equal(plan.anthropic?.thinking?.type, "adaptive");
    assert.equal(plan.anthropic?.effort, "low");
    assert.match(plan.note ?? "", /cannot turn thinking off/);
  });

  it("disables thinking for Claude models that allow it", () => {
    const plan = planThinking("anthropic", "claude-haiku-5-5", "off");
    assert.deepEqual(plan.anthropic?.thinking, { type: "disabled" });
    assert.equal(plan.anthropic?.effort, "low");
  });

  it("sends Anthropic effort and summarized adaptive thinking", () => {
    const plan = planThinking("anthropic", "claude-fable-5-1", "xhigh");
    assert.equal(plan.anthropic?.effort, "xhigh");
    assert.deepEqual(plan.anthropic?.thinking, { type: "adaptive", display: "summarized" });
  });

  it("maps OpenAI off to reasoning_effort none, except models without that level", () => {
    assert.equal(planThinking("openai", "gpt-6-luna", "off").openaiReasoningEffort, "none");
    assert.equal(planThinking("openai", "gpt-6-astra", "off").openaiReasoningEffort, "low");
    assert.equal(planThinking("openai", "gpt-6.1-sol", "high").openaiReasoningEffort, "high");
  });

  it("maps Grok off to low reasoning effort", () => {
    const plan = planThinking("xai", "grok-4.7", "off");
    assert.equal(plan.xaiReasoningEffort, "low");
    assert.match(plan.note ?? "", /cannot turn reasoning off/);
    assert.equal(planThinking("xai", "grok-4.7", "xhigh").xaiReasoningEffort, "xhigh");
  });

  it("maps Ollama think to false, a level, or max", () => {
    assert.equal(planThinking("ollama", "qwen3", "off").ollamaThink, false);
    assert.equal(planThinking("ollama", "qwen3", "medium").ollamaThink, "medium");
    assert.equal(planThinking("ollama", "qwen3", "xhigh").ollamaThink, "max");
  });

  it("does not invent an Apple Intelligence thinking control", () => {
    const plan = planThinking("apple", "", "high");
    assert.equal(plan.anthropic, undefined);
    assert.equal(plan.openaiReasoningEffort, undefined);
    assert.match(plan.note ?? "", /no thinking control/);
  });
});

describe("model choices", () => {
  const base = {
    defaultProvider: "anthropic" as const,
    installedOllamaModels: [],
    defaultModel: "claude-haiku-5-5",
    customModelId: "my-model",
  };

  it("uses the curated Claude list, the custom id, and the default model", () => {
    const choices = buildModelChoices({ ...base, provider: "anthropic" });
    assert.ok(choices.some((choice) => choice.id === "claude-opus-5-5"));
    assert.ok(choices.some((choice) => choice.id === "my-model"));
    assert.equal(selectModel({ ...base, provider: "anthropic" }), "claude-haiku-5-5");
  });

  it("does not force a Claude default model onto ChatGPT", () => {
    assert.equal(selectModel({ ...base, provider: "openai" }), "gpt-6-astra");
  });

  it("lists installed Ollama models and keeps a valid current choice", () => {
    const input = {
      ...base,
      provider: "ollama" as const,
      defaultProvider: "ollama" as const,
      installedOllamaModels: ["llama3.2", "qwen3"],
      defaultModel: "qwen3",
    };
    assert.deepEqual(
      buildModelChoices(input).map((choice) => choice.id),
      ["llama3.2", "qwen3", "my-model"],
    );
    assert.equal(selectModel(input, "llama3.2"), "llama3.2");
  });
});

describe("streams", () => {
  it("parses Anthropic text and thinking deltas split across chunks", () => {
    const first = parseSse(
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Hmm"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_del',
    );
    assert.equal(first.events.length, 1);
    assert.deepEqual(deltasFromAnthropic(first.events[0].data), [{ kind: "thinking", text: "Hmm" }]);
    const second = parseSse(`${first.rest}ta","delta":{"type":"text_delta","text":"Hi"}}\n\n`);
    assert.deepEqual(deltasFromAnthropic(second.events[0].data), [{ kind: "text", text: "Hi" }]);
  });

  it("parses OpenAI chat chunks and the done marker", () => {
    assert.deepEqual(deltasFromChatChunk('{"choices":[{"delta":{"content":"Hi","reasoning_content":"Why"}}]}'), [
      { kind: "thinking", text: "Why" },
      { kind: "text", text: "Hi" },
    ]);
    assert.deepEqual(deltasFromChatChunk("[DONE]"), []);
  });

  it("parses xAI response deltas", () => {
    assert.deepEqual(
      deltasFromResponsesEvent(
        "response.reasoning_summary_text.delta",
        '{"type":"response.reasoning_summary_text.delta","delta":"Step"}',
      ),
      [{ kind: "thinking", text: "Step" }],
    );
    assert.deepEqual(
      deltasFromResponsesEvent("response.output_text.delta", '{"type":"response.output_text.delta","delta":"Answer"}'),
      [{ kind: "text", text: "Answer" }],
    );
  });

  it("parses Ollama thinking and content lines", () => {
    assert.deepEqual(deltasFromOllama('{"message":{"thinking":"Count","content":""}}'), [
      { kind: "thinking", text: "Count" },
    ]);
    assert.deepEqual(deltasFromOllama('{"message":{"content":"3"}}'), [{ kind: "text", text: "3" }]);
  });
});

describe("errors and storage", () => {
  it("explains a rejected API key", () => {
    const message = formatHttpError(401, '{"error":{"message":"invalid x-api-key"}}', "Claude");
    assert.match(message, /rejected the API key/);
    assert.match(message, /invalid x-api-key/);
  });

  it("clips noisy provider bodies", () => {
    assert.equal(extractErrorMessage("  not json  "), "not json");
  });

  it("ignores corrupt saved prompts", () => {
    assert.deepEqual(parsePrompts("nope"), []);
    assert.equal(parsePrompts(JSON.stringify([{ id: "1", name: "A", body: "B", updatedAt: 2 }])).length, 1);
  });

  it("names a missing Apple Intelligence shortcut", () => {
    assert.match(formatShortcutError("Ask Apple Intelligence", new Error("Could not find shortcut")), /couldn't find/i);
  });
});

describe("desktop handoff", () => {
  it("builds the Claude new-chat URL and truncates long prompts", () => {
    const prompt = "Hello Claude";
    assert.equal(claudeDesktopUrl(prompt).url, "claude://claude.ai/new?q=Hello%20Claude");
    const long = "a".repeat(CLAUDE_PROMPT_LIMIT + 20);
    const result = claudeDesktopUrl(long);
    assert.equal(result.truncated, true);
    assert.equal(decodeURIComponent(result.url.split("q=")[1]).length, CLAUDE_PROMPT_LIMIT);
  });

  it("pastes into ChatGPT without sending the message", () => {
    const script = chatGptPasteScript("/tmp/personal-ai/prompt.txt");
    assert.match(script, /tell application "ChatGPT"/);
    assert.match(script, /keystroke "v"/);
    assert.doesNotMatch(script, /keystroke return/);
    assert.equal(chatgptDesktopUrl("Hi there"), "chatgpt://chatgpt.com/?q=Hi%20there");
  });
});

describe("ollama url", () => {
  it("defaults and joins API paths", () => {
    assert.equal(normalizeBaseUrl("  "), "http://127.0.0.1:11434");
    assert.equal(ollamaApiUrl("http://127.0.0.1:11434/", "/api/tags"), "http://127.0.0.1:11434/api/tags");
  });

  it("rejects a non-http base URL", () => {
    assert.throws(() => normalizeBaseUrl("file:///tmp/ollama"), /http/);
  });
});

describe("reply view", () => {
  it("shows loading, the answer, and an empty result", () => {
    assert.match(renderReply(view({ pending: true })), /Sending your prompt/);
    assert.match(renderReply(view({ pending: false, answer: "Done" })), /Done/);
    assert.match(renderReply(view({ pending: false })), /empty reply/);
  });

  it("shows a provider failure before any text arrives", () => {
    assert.match(
      renderReply(view({ pending: false, error: "Add your OpenAI API key in Raycast extension preferences." })),
      /Couldn't get a reply/,
    );
  });
});

function view(overrides: Partial<Parameters<typeof renderReply>[0]>): Parameters<typeof renderReply>[0] {
  return {
    thinking: "",
    answer: "",
    providerLabel: "ChatGPT",
    model: "gpt-6-luna",
    thinkingLabel: "Medium",
    pending: false,
    ...overrides,
  };
}
