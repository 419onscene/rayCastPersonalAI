import { homedir } from "os";
import { dirname } from "path";
import { statSync } from "fs";
import { type CliName } from "./types";

const INSTALL_HINT: Record<CliName, string> = {
  claude: "Install Claude Code so the claude command exists.",
  codex: "Install the Codex CLI (the official local ChatGPT CLI) and sign in with ChatGPT.",
  grok: "Install the Grok CLI so the grok command exists, and sign in.",
  ollama: "Install Ollama so the ollama command exists.",
  shortcuts: "Apple Intelligence handoff needs the macOS shortcuts command.",
};

export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function candidatePaths(command: CliName, home: string): string[] {
  if (command === "claude") {
    return [`${home}/.local/bin/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  }
  if (command === "codex") {
    return [`${home}/.local/bin/codex`, "/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
  }
  if (command === "grok") {
    return [`${home}/.local/bin/grok`, `${home}/.grok/bin/grok`, "/opt/homebrew/bin/grok", "/usr/local/bin/grok"];
  }
  if (command === "ollama") {
    return [
      "/usr/local/bin/ollama",
      "/opt/homebrew/bin/ollama",
      "/Applications/Ollama.app/Contents/Resources/ollama",
      `${home}/.local/bin/ollama`,
    ];
  }
  return ["/usr/bin/shortcuts"];
}

export function resolveCliBinary(input: {
  command: CliName;
  preferencePath: string;
  home?: string;
  exists?: (path: string) => boolean;
}): { path: string } | { error: string } {
  const home = input.home ?? homedir();
  const exists = input.exists ?? fileExists;
  const preference = input.preferencePath.trim();
  const candidates = candidatePaths(input.command, home);

  if (preference) {
    if (exists(preference)) return { path: preference };
    return {
      error: missingCliMessage(input.command, [preference, ...candidates], true),
    };
  }

  for (const path of candidates) {
    if (exists(path)) return { path };
  }
  return { error: missingCliMessage(input.command, candidates, false) };
}

export function missingCliMessage(command: CliName, lookedIn: string[], preferenceMissing: boolean): string {
  const where = lookedIn.join(", ");
  const preference = preferenceMissing
    ? `The path in preferences was not found. Also looked in ${where}. `
    : `Looked in ${where}. `;
  return `\`${command}\` isn't available. ${INSTALL_HINT[command]} ${preference}Raycast does not inherit your shell PATH, and this extension does not fall back to an API key. Set the binary path in extension preferences.`;
}

export function commandEnv(binaryPath: string, extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const home = homedir();
  const prefix = [dirname(binaryPath), `${home}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const current = process.env.PATH ?? "";
  const path = [...prefix, ...current.split(":")].filter((part, index, all) => part && all.indexOf(part) === index);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: path.join(":") };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) env[key] = value;
    else delete env[key];
  }
  return env;
}
