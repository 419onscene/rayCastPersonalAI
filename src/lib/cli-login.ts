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
  return `${name} isn't signed in yet. ${shown} should open a browser. Finish that sign-in, then ask again.`;
}

export function startCliLogin(binary: string, command: CliName): void {
  const args = loginArgs(command);
  if (!args) return;
  const child = spawn(binary, args, {
    detached: true,
    stdio: "ignore",
    env: commandEnv(binary),
  });
  child.unref();
}

export async function ensureSignedIn(
  binary: string,
  command: CliName,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const args = statusArgs(command);
  if (!args) return undefined;
  const state = await loginState(binary, args, signal);
  if (state !== "no") return undefined;
  startCliLogin(binary, command);
  return loginRequiredMessage(command);
}

async function loginState(binary: string, args: string[], signal?: AbortSignal): Promise<"yes" | "no" | "unknown"> {
  const timeout = AbortSignal.timeout(10000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    await runCommand(binary, args, { env: commandEnv(binary), signal: combined });
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
