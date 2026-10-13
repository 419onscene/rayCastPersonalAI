import { spawnSync } from "child_process";
import { statSync } from "fs";
import { homedir } from "os";
import { dirname } from "path";
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
    return [
      `${home}/.local/bin/codex`,
      `${home}/.codex/plugins/.plugin-appserver/codex-cli/bin/codex`,
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ];
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

const USER_PLACEHOLDER = "<your-user-name>";

export function expandCliPath(path: string, home: string): string {
  const user = home.split("/").filter(Boolean).pop() ?? "";
  return path.trim().replaceAll(USER_PLACEHOLDER, user);
}

export function resolveCliBinary(input: {
  command: CliName;
  preferencePath: string;
  home?: string;
  exists?: (path: string) => boolean;
  pathDirs?: string[];
}): { path: string } | { error: string } {
  const home = input.home ?? homedir();
  const exists = input.exists ?? fileExists;
  const preference = expandCliPath(input.preferencePath, home);
  const candidates = candidatePaths(input.command, home);
  const fromPath = (input.pathDirs ?? (input.exists ? [] : loginPathDirs())).map((dir) => `${dir}/${input.command}`);
  const lookedIn = [...(preference ? [preference] : []), ...candidates, ...fromPath];

  if (preference && exists(preference)) return { path: preference };
  for (const path of candidates) {
    if (exists(path)) return { path };
  }
  for (const path of fromPath) {
    if (exists(path)) return { path };
  }
  return { error: missingCliMessage(input.command, lookedIn, Boolean(preference)) };
}

export function missingCliMessage(command: CliName, lookedIn: string[], preferenceMissing: boolean): string {
  const where = lookedIn.join(", ");
  const preference = preferenceMissing
    ? `The path in preferences was not found. Also looked in ${where}. `
    : `Looked in ${where}. `;
  return `\`${command}\` isn't available. ${INSTALL_HINT[command]} ${preference}Raycast does not inherit your shell PATH, and this extension does not fall back to an API key. Set the binary path in extension preferences.`;
}

let cachedLoginDirs: string[] | undefined;

export function loginPathDirs(): string[] {
  if (cachedLoginDirs) return cachedLoginDirs;
  cachedLoginDirs = readLoginPath();
  return cachedLoginDirs;
}

function readLoginPath(): string[] {
  for (const shell of ["/bin/zsh", "/bin/bash"]) {
    try {
      const result = spawnSync(shell, ["-lc", 'printf %s "$PATH"'], {
        encoding: "utf8",
        timeout: 4000,
        env: { ...process.env, HOME: homedir() },
      });
      if (result.status === 0 && result.stdout.trim()) {
        return result.stdout.trim().split(":").filter(Boolean);
      }
    } catch {
      // The next shell may exist on this Mac.
    }
  }
  return (process.env.PATH ?? "").split(":").filter(Boolean);
}

export function commandEnv(
  binaryPath: string,
  extra?: Record<string, string | undefined>,
  home?: string,
): NodeJS.ProcessEnv {
  const resolvedHome = home ?? homedir();
  const prefix = [
    dirname(binaryPath),
    ...loginPathDirs(),
    `${resolvedHome}/.local/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
  const current = process.env.PATH ?? "";
  const path = [...prefix, ...current.split(":")].filter((part, index, all) => part && all.indexOf(part) === index);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: path.join(":") };
  if (home) env.HOME = home;
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) env[key] = value;
    else delete env[key];
  }
  return env;
}
