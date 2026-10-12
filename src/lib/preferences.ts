import { getPreferenceValues } from "@raycast/api";
import { type CliName, type ExtensionPreferences, isProviderId } from "./types";

export function readPreferences(): ExtensionPreferences {
  const values = getPreferenceValues<ExtensionPreferences>();
  return {
    defaultProvider: isProviderId(values.defaultProvider) ? values.defaultProvider : "anthropic",
    defaultModel: values.defaultModel?.trim() ?? "",
    defaultThinking: values.defaultThinking?.trim() ?? "",
    ollamaHost: values.ollamaHost?.trim() ?? "",
    appleShortcutName: values.appleShortcutName?.trim() || "Ask Apple Intelligence",
    claudeCliPath: values.claudeCliPath?.trim() ?? "",
    codexCliPath: values.codexCliPath?.trim() ?? "",
    grokCliPath: values.grokCliPath?.trim() ?? "",
    ollamaCliPath: values.ollamaCliPath?.trim() ?? "",
    shortcutsCliPath: values.shortcutsCliPath?.trim() ?? "",
  };
}

export function cliPathFor(preferences: ExtensionPreferences, command: CliName): string {
  if (command === "claude") return preferences.claudeCliPath;
  if (command === "codex") return preferences.codexCliPath;
  if (command === "grok") return preferences.grokCliPath;
  if (command === "ollama") return preferences.ollamaCliPath;
  return preferences.shortcutsCliPath;
}
