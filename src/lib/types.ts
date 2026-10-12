export type ProviderId = "anthropic" | "openai" | "xai" | "ollama" | "apple";

export type ThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh";

export interface ExtensionPreferences {
  defaultProvider: ProviderId;
  defaultModel: string;
  defaultThinking: ThinkingLevel;
  customModelId: string;
  ollamaBaseUrl: string;
  appleShortcutName: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  xaiApiKey: string;
}

export interface SavedPrompt {
  id: string;
  name: string;
  body: string;
  updatedAt: number;
}

export interface ReplyDelta {
  kind: "text" | "thinking";
  text: string;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  xai: "Grok",
  ollama: "Ollama",
  apple: "Apple Intelligence",
};

export const THINKING_LABEL: Record<ThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

export const PROVIDERS: { id: ProviderId; title: string }[] = [
  { id: "anthropic", title: "Claude" },
  { id: "openai", title: "ChatGPT" },
  { id: "xai", title: "Grok" },
  { id: "ollama", title: "Ollama" },
  { id: "apple", title: "Apple Intelligence" },
];

export const THINKING_LEVELS: { id: ThinkingLevel; title: string }[] = [
  { id: "off", title: "Off" },
  { id: "low", title: "Low" },
  { id: "medium", title: "Medium" },
  { id: "high", title: "High" },
  { id: "xhigh", title: "Extra high" },
];

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((provider) => provider.id === value);
}

export function isThinkingLevel(value: string): value is ThinkingLevel {
  return THINKING_LEVELS.some((level) => level.id === value);
}
