import { type ProviderId } from "./types";

export interface ThinkingOption {
  id: string;
  title: string;
}

export interface ThinkingCatalog {
  levels: ThinkingOption[];
  defaultLevel?: string;
  note?: string;
}

const TITLES: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

interface LevelSet {
  levels: string[];
  defaultLevel: string;
}

// https://code.claude.com/docs/en/model-config — models not listed do not support effort.
const CLAUDE_FULL = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_NO_XHIGH = ["low", "medium", "high", "max"];
const CLAUDE: Record<string, LevelSet> = {
  "claude-fable-5-1": { levels: CLAUDE_FULL, defaultLevel: "high" },
  "claude-fable-5": { levels: CLAUDE_FULL, defaultLevel: "high" },
  "claude-opus-5-5": { levels: CLAUDE_FULL, defaultLevel: "medium" },
  "claude-sonnet-5-5": { levels: CLAUDE_FULL, defaultLevel: "medium" },
  "claude-haiku-5-5": { levels: CLAUDE_FULL, defaultLevel: "medium" },
  "claude-opus-5": { levels: CLAUDE_FULL, defaultLevel: "high" },
  "claude-sonnet-5": { levels: CLAUDE_FULL, defaultLevel: "high" },
  "claude-opus-4-8": { levels: CLAUDE_FULL, defaultLevel: "high" },
  "claude-opus-4-7": { levels: CLAUDE_FULL, defaultLevel: "xhigh" },
  "claude-opus-4-6": { levels: CLAUDE_NO_XHIGH, defaultLevel: "high" },
  "claude-sonnet-4-6": { levels: CLAUDE_NO_XHIGH, defaultLevel: "high" },
};

// https://learn.chatgpt.com/docs/models — only levels that page names for the model.
const CODEX_THROUGH_XHIGH = ["low", "medium", "high", "xhigh"];
const CODEX_THROUGH_MAX = [...CODEX_THROUGH_XHIGH, "max"];
const CODEX_THROUGH_ULTRA = [...CODEX_THROUGH_MAX, "ultra"];
const CODEX: Record<string, LevelSet> = {
  "gpt-6-astra": { levels: CODEX_THROUGH_XHIGH, defaultLevel: "low" },
  "gpt-6.1-sol": { levels: CODEX_THROUGH_ULTRA, defaultLevel: "medium" },
  "gpt-6-luna": { levels: CODEX_THROUGH_MAX, defaultLevel: "high" },
};

// https://docs.x.ai/developers/model-capabilities/text/reasoning
const GROK_WITH_XHIGH = ["low", "medium", "high", "xhigh"];
const GROK_THROUGH_HIGH = ["low", "medium", "high"];
const GROK: Record<string, LevelSet> = {
  "grok-4.7": { levels: GROK_WITH_XHIGH, defaultLevel: "high" },
  "grok-4.6": { levels: GROK_WITH_XHIGH, defaultLevel: "high" },
  "grok-4.5": { levels: GROK_THROUGH_HIGH, defaultLevel: "high" },
};

export function levelTitle(id: string): string {
  if (!id) return "CLI default";
  return TITLES[id] ?? id;
}

export function thinkingCatalog(
  provider: ProviderId,
  model: string,
  reported?: { values: string[]; defaultValue?: string; reported: boolean },
): ThinkingCatalog {
  if (provider === "apple") {
    return {
      levels: [],
      note: "Apple Intelligence has no thinking control. The shortcut runs the way you built it.",
    };
  }

  if (provider === "ollama") {
    if (!reported?.reported) {
      return {
        levels: [],
        note: "Ollama didn't report thinking levels for this model, so this run won't pass --think.",
      };
    }
    return reportedCatalog(
      reported.values,
      reported.defaultValue,
      "Ollama reported no thinking levels for this model, so this run won't pass --think.",
    );
  }

  if (reported?.reported) {
    return reportedCatalog(
      reported.values,
      reported.defaultValue,
      "This model reported no thinking levels, so this run won't pass an effort flag.",
    );
  }

  const known = lookup(provider, model);
  if (!known) {
    return {
      levels: [],
      note: unlistedNote(provider),
    };
  }
  return catalogFrom(known.levels, known.defaultLevel);
}

export function selectThinking(catalog: ThinkingCatalog, preference: string, current?: string): string {
  const ids = new Set(catalog.levels.map((level) => level.id));
  if (current && ids.has(current)) return current;
  const preferred = preference.trim();
  if (preferred && ids.has(preferred)) return preferred;
  if (catalog.defaultLevel && ids.has(catalog.defaultLevel)) return catalog.defaultLevel;
  return catalog.levels[0]?.id ?? "";
}

export function offeredLevel(catalog: ThinkingCatalog, level: string): string | undefined {
  const trimmed = level.trim();
  if (!trimmed || trimmed === "off" || trimmed === "none") return undefined;
  return catalog.levels.some((item) => item.id === trimmed) ? trimmed : undefined;
}

function lookup(provider: ProviderId, model: string): LevelSet | undefined {
  const key = modelKey(model);
  if (provider === "anthropic") return CLAUDE[key];
  if (provider === "openai") return CODEX[key];
  if (provider === "xai") {
    if (key.startsWith("grok-4.20")) return { levels: GROK_WITH_XHIGH, defaultLevel: "high" };
    return GROK[key];
  }
  return undefined;
}

function modelKey(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const slash = trimmed.split("/").pop() ?? trimmed;
  return slash.split(":").shift() ?? slash;
}

function reportedCatalog(levels: string[], defaultLevel: string | undefined, emptyNote: string): ThinkingCatalog {
  const catalog = catalogFrom(levels, defaultLevel);
  if (catalog.levels.length === 0) return { levels: [], note: emptyNote };
  return catalog;
}

function catalogFrom(levels: string[], defaultLevel?: string): ThinkingCatalog {
  const kept = withoutOff(levels);
  const options = kept.map((id) => ({ id, title: levelTitle(id) }));
  const fallback = defaultLevel && kept.includes(defaultLevel) ? defaultLevel : kept[0];
  return { levels: options, defaultLevel: fallback };
}

function withoutOff(levels: string[]): string[] {
  return levels.filter((level) => level !== "off" && level !== "none" && level !== "false");
}

function unlistedNote(provider: ProviderId): string {
  if (provider === "anthropic") {
    return "Claude Code doesn't list effort for this model, so this run won't pass --effort.";
  }
  if (provider === "openai") {
    return "The ChatGPT models page doesn't list reasoning levels for this model, so this run won't pass model_reasoning_effort.";
  }
  return "xAI's reasoning docs don't list effort for this model, so this run won't pass --effort.";
}
