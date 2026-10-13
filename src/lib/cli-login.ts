import { spawn } from "child_process";
import { commandEnv } from "./binaries";
import { commandErrorText, runCommand } from "./process";
import { type CliName } from "./types";

export function loginArgs(command: CliName): string[] | undefined {
  if (command === "claude") return ["auth", "login"];
  if (command === "codex" || command === "grok") return ["login"];
  return undefined;
}

export function statusArgs(command: CliName): string[] | undefined {
  if (command === "claude") return ["auth", "status"];
  if (command === "codex") return ["login", "status"];
  return undefined;
}

export function isAuthFailure(text: string): boolean {
  return /sign in|log in|logged out|not authenticated|unauthorized|authentication required|auth required|please (run|use) [`']?(claude auth login|codex login|grok login)/i.test(
    text,
  );
}

export function loginRequiredMessage(command: CliName): string {
  const args = loginArgs(command);
  const shown = args ? `\`${command} ${args.join(" ")}\`` : `\`${command}\``;
  const name = command === "claude" ? "Claude" : command === "codex" ? "ChatGPT" : "Grok";
  return `${name} isn't signed in. Open Add AI, select ${name}, and finish the Terminal sign-in. That screen keeps the credential in providers.json. The command is ${shown}.`;
}

export function loginUrls(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])];
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function terminalLoginCommand(binary: string, command: CliName, home?: string): string | undefined {
  const args = loginArgs(command);
  if (!args) return undefined;
  const line = [binary, ...args].map(shellQuote).join(" ");
  if (!home) return line;
  return `export HOME=${shellQuote(home)}; ${line}`;
}

export function terminalLoginAppleScript(shellCommand: string): string {
  const escaped = shellCommand.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`;
}

export function runCliLogin(input: {
  binary: string;
  command: CliName;
  home?: string;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const args = loginArgs(input.command);
  if (!args) return Promise.resolve({ ok: false, error: "This provider has no CLI login." });
  return new Promise((resolve) => {
    const child = spawn(input.binary, args, {
      env: commandEnv(input.binary, undefined, input.home),
      stdio: ["pipe", "pipe", "pipe"],
      signal: input.signal,
    });
    let output = "";
    let settled = false;
    const finish = (result: { ok: true; output: string } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const push = (chunk: string) => {
      output += chunk;
      input.onOutput?.(chunk);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", push);
    child.stderr.on("data", push);
    child.stdin.on("error", () => undefined);
    try {
      child.stdin.write("\n");
    } catch {
      // The login process can exit before the newline is written.
    }
    child.on("error", (error) => {
      if (input.signal?.aborted) finish({ ok: false, error: "Sign-in cancelled." });
      else finish({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      if (input.signal?.aborted) finish({ ok: false, error: "Sign-in cancelled." });
      else if (code === 0) finish({ ok: true, output });
      else finish({ ok: false, error: clipLogin(output) || `Login exited with code ${code ?? "unknown"}` });
    });
  });
}

export async function credentialState(
  binary: string,
  command: CliName,
  signal?: AbortSignal,
  home?: string,
): Promise<"yes" | "no" | "unknown"> {
  const timeout = AbortSignal.timeout(15000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  if (command === "grok") {
    try {
      await runCommand(binary, ["models"], { env: commandEnv(binary, undefined, home), signal: combined });
      return "yes";
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) return "unknown";
      const text = commandErrorText(error);
      if (isAuthFailure(text) || /exited with code 1\b/.test(text)) return "no";
      return "unknown";
    }
  }
  const args = statusArgs(command);
  if (!args) return "unknown";
  return loginState(binary, args, signal, home);
}

export async function ensureSignedIn(
  binary: string,
  command: CliName,
  signal?: AbortSignal,
  home?: string,
): Promise<string | undefined> {
  const args = statusArgs(command);
  if (!args) return undefined;
  const state = await loginState(binary, args, signal, home);
  if (state !== "no") return undefined;
  return loginRequiredMessage(command);
}

function clipLogin(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}

async function loginState(
  binary: string,
  args: string[],
  signal?: AbortSignal,
  home?: string,
): Promise<"yes" | "no" | "unknown"> {
  const timeout = AbortSignal.timeout(10000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    await runCommand(binary, args, { env: commandEnv(binary, undefined, home), signal: combined });
    return "yes";
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) return "unknown";
    const text = commandErrorText(error);
    if (/unknown command|unrecognized|not found|no such/i.test(text)) return "unknown";
    if (isAuthFailure(text) || /exited with code 1\b/.test(text)) return "no";
    return "unknown";
  }
}
