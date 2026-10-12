import { type ProviderId } from "./types";

export interface ModelChoice {
  id: string;
  title: string;
}

export interface CuratedModel {
  id: string;
  title: string;
  recommended?: boolean;
}

export const CURATED_MODELS: Record<"anthropic" | "openai" | "xai", CuratedModel[]> = {
  anthropic: [
    { id: "claude-opus-5-5", title: "Claude Opus 5.5", recommended: true },
    { id: "claude-fable-5-1", title: "Claude Fable 5.1" },
    { id: "claude-sonnet-5-5", title: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", title: "Claude Haiku 5.5" },
  ],
  openai: [
    { id: "gpt-6-astra", title: "GPT-6 Astra", recommended: true },
    { id: "gpt-6.1-sol", title: "GPT-6.1 Sol" },
    { id: "gpt-6-sol", title: "GPT-6 Sol" },
    { id: "gpt-6-luna", title: "GPT-6 Luna" },
    { id: "gpt-5.6-sol", title: "GPT-5.6 Sol" },
  ],
  xai: [
    { id: "grok-4.7", title: "Grok 4.7", recommended: true },
    { id: "grok-4.6", title: "Grok 4.6" },
    { id: "grok-4.5", title: "Grok 4.5" },
    { id: "grok-4.3", title: "Grok 4.3" },
  ],
};

export function recommendedModel(provider: "anthropic" | "openai" | "xai"): string {
  const models = CURATED_MODELS[provider];
  return models.find((model) => model.recommended)?.id ?? models[0].id;
}

export function buildModelChoices(input: {
  provider: ProviderId;
  defaultProvider: ProviderId;
  installedOllamaModels: string[];
  defaultModel: string;
  customModelId: string;
}): ModelChoice[] {
  if (input.provider === "apple") return [];

  const choices: ModelChoice[] = [];
  const seen = new Set<string>();
  const add = (id: string, title: string) => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    choices.push({ id: trimmed, title });
  };

  if (input.provider === "ollama") {
    for (const name of input.installedOllamaModels) add(name, name);
  } else {
    for (const model of CURATED_MODELS[input.provider]) add(model.id, model.title);
  }

  const custom = input.customModelId.trim();
  if (custom) add(custom, `Custom (${custom})`);

  const preferred = input.defaultModel.trim();
  if (preferred && input.provider === input.defaultProvider) add(preferred, `Preference (${preferred})`);

  return choices;
}

export function selectModel(
  input: {
    provider: ProviderId;
    defaultProvider: ProviderId;
    installedOllamaModels: string[];
    defaultModel: string;
    customModelId: string;
  },
  current?: string,
): string {
  const choices = buildModelChoices(input);
  if (current && choices.some((choice) => choice.id === current)) return current;

  const preferred = input.defaultModel.trim();
  if (input.provider === input.defaultProvider && preferred && choices.some((choice) => choice.id === preferred)) {
    return preferred;
  }

  if (input.provider === "anthropic" || input.provider === "openai" || input.provider === "xai") {
    const recommended = recommendedModel(input.provider);
    if (choices.some((choice) => choice.id === recommended)) return recommended;
  }

  return choices[0]?.id ?? "";
}
