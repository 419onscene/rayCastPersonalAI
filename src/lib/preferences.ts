import { getPreferenceValues } from "@raycast/api";
import { isProviderId, isThinkingLevel, type ExtensionPreferences, type ProviderId, type ThinkingLevel } from "./types";

export function readPreferences(): ExtensionPreferences {
  const values = getPreferenceValues<ExtensionPreferences>();
  return {
    defaultProvider: isProviderId(values.defaultProvider) ? values.defaultProvider : "anthropic",
    defaultModel: values.defaultModel?.trim() ?? "",
    defaultThinking: isThinkingLevel(values.defaultThinking) ? values.defaultThinking : "medium",
    customModelId: values.customModelId?.trim() ?? "",
    ollamaBaseUrl: values.ollamaBaseUrl?.trim() || "http://127.0.0.1:11434",
    appleShortcutName: values.appleShortcutName?.trim() || "Ask Apple Intelligence",
    anthropicApiKey: values.anthropicApiKey ?? "",
    openaiApiKey: values.openaiApiKey ?? "",
    xaiApiKey: values.xaiApiKey ?? "",
  };
}

export function apiKeyFor(preferences: ExtensionPreferences, provider: ProviderId): string {
  if (provider === "anthropic") return preferences.anthropicApiKey;
  if (provider === "openai") return preferences.openaiApiKey;
  if (provider === "xai") return preferences.xaiApiKey;
  return "";
}

export function initialThinking(preferences: ExtensionPreferences): ThinkingLevel {
  return preferences.defaultThinking;
}
