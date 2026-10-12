export type ProviderId = "anthropic" | "openai" | "xai" | "ollama" | "apple";

export type CliName = "claude" | "codex" | "grok" | "ollama" | "shortcuts";

export interface ExtensionPreferences {
  defaultProvider: ProviderId;
  defaultModel: string;
  defaultThinking: string;
  customModelId: string;
  ollamaHost: string;
  appleShortcutName: string;
  claudeCliPath: string;
  codexCliPath: string;
  grokCliPath: string;
  ollamaCliPath: string;
  shortcutsCliPath: string;
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

export const CLI_COMMAND: Record<ProviderId, CliName> = {
  anthropic: "claude",
  openai: "codex",
  xai: "grok",
  ollama: "ollama",
  apple: "shortcuts",
};

export const PROVIDERS: { id: ProviderId; title: string }[] = [
  { id: "anthropic", title: "Claude" },
  { id: "openai", title: "ChatGPT" },
  { id: "xai", title: "Grok" },
  { id: "ollama", title: "Ollama" },
  { id: "apple", title: "Apple Intelligence" },
];

export function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.some((provider) => provider.id === value);
}
