import { type ProviderId, type ThinkingLevel } from "./types";

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh";
export type OpenAIReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type XaiReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type OllamaThink = false | "low" | "medium" | "high" | "max";

export interface ThinkingPlan {
  note?: string;
  anthropic?: {
    thinking?: { type: "adaptive" | "disabled" | "between_tools"; display?: "summarized" };
    effort: AnthropicEffort;
  };
  openaiReasoningEffort?: OpenAIReasoningEffort;
  xaiReasoningEffort?: XaiReasoningEffort;
  ollamaThink?: OllamaThink;
}

const ANTHROPIC_ALWAYS_ON = new Set(["claude-fable-5-1", "claude-opus-5-5"]);
const ANTHROPIC_BETWEEN_TOOLS_WHEN_OFF = new Set(["claude-sonnet-5-5"]);
const ANTHROPIC_SUMMARIZED_THINKING = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
]);

const OPENAI_NO_NONE = new Set(["gpt-6-astra", "gpt-6.1-sol"]);

export function outputTokenCap(level: ThinkingLevel): number {
  if (level === "xhigh") return 64000;
  if (level === "high") return 32000;
  if (level === "medium") return 16000;
  return 8000;
}

export function planThinking(provider: ProviderId, model: string, level: ThinkingLevel): ThinkingPlan {
  if (provider === "anthropic") return planAnthropic(model, level);
  if (provider === "openai") return planOpenAI(model, level);
  if (provider === "xai") return planXai(level);
  if (provider === "ollama") return planOllama(level);
  return {
    note:
      level === "off"
        ? undefined
        : "Apple Intelligence has no thinking control. The shortcut runs the way you built it.",
  };
}

function planAnthropic(model: string, level: ThinkingLevel): ThinkingPlan {
  if (level === "off") {
    if (ANTHROPIC_ALWAYS_ON.has(model)) {
      return {
        note: "This Claude model cannot turn thinking off. Sent low effort instead.",
        anthropic: { thinking: adaptiveThinking(model), effort: "low" },
      };
    }
    if (ANTHROPIC_BETWEEN_TOOLS_WHEN_OFF.has(model)) {
      return {
        note: "Claude Sonnet 5.5 has no full off switch. Sent between-tools thinking at low effort.",
        anthropic: { thinking: { type: "between_tools" }, effort: "low" },
      };
    }
    return {
      anthropic: { thinking: { type: "disabled" }, effort: "low" },
    };
  }

  return {
    anthropic: {
      thinking: adaptiveThinking(model),
      effort: level,
    },
  };
}

function adaptiveThinking(model: string): { type: "adaptive"; display?: "summarized" } {
  if (ANTHROPIC_SUMMARIZED_THINKING.has(model)) return { type: "adaptive", display: "summarized" };
  return { type: "adaptive" };
}

function planOpenAI(model: string, level: ThinkingLevel): ThinkingPlan {
  if (level === "off" && OPENAI_NO_NONE.has(model)) {
    return {
      note: "This OpenAI model has no off switch. Sent reasoning_effort low.",
      openaiReasoningEffort: "low",
    };
  }
  return { openaiReasoningEffort: level === "off" ? "none" : level };
}

function planXai(level: ThinkingLevel): ThinkingPlan {
  if (level === "off") {
    return {
      note: "Current Grok models cannot turn reasoning off. Sent reasoning effort low.",
      xaiReasoningEffort: "low",
    };
  }
  return { xaiReasoningEffort: level };
}

function planOllama(level: ThinkingLevel): ThinkingPlan {
  if (level === "off") return { ollamaThink: false };
  if (level === "xhigh") {
    return {
      note: "Ollama calls its highest thinking level max.",
      ollamaThink: "max",
    };
  }
  return { ollamaThink: level };
}
