import { spawn } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { commandEnv } from "./binaries";
import { shellQuote } from "./cli-login";
import { type CliName, type ProviderId } from "./types";

export type SubscriptionProviderId = "anthropic" | "openai" | "xai";

export interface SubscriptionProvider {
  id: SubscriptionProviderId;
  grantKey: "claude" | "chatgpt" | "grok";
  title: string;
  command: CliName;
  loginArgs: string[];
  logoutArgs: string[];
  statusArgs?: string[];
}

export const SUBSCRIPTIONS: SubscriptionProvider[] = [
  {
    id: "anthropic",
    grantKey: "claude",
    title: "Claude",
    command: "claude",
    loginArgs: ["auth", "login"],
    logoutArgs: ["auth", "logout"],
    statusArgs: ["auth", "status"],
  },
  {
    id: "openai",
    grantKey: "chatgpt",
    title: "ChatGPT",
    command: "codex",
    loginArgs: ["login"],
    logoutArgs: ["logout"],
    statusArgs: ["login", "status"],
  },
  {
    id: "xai",
    grantKey: "grok",
    title: "Grok",
    command: "grok",
    loginArgs: ["login"],
    logoutArgs: ["logout"],
  },
];

export interface ProviderGrant {
  authorized: boolean;
  method: string | null;
  testedAt?: string;
}

export interface CommandCapture {
  code: number;
  stdout: string;
  stderr: string;
}

const LOGIN_TIMEOUT_MS = 20 * 60 * 1000;
const LOGIN_POLL_MS = 400;

export function isSubscriptionProvider(provider: ProviderId): provider is SubscriptionProviderId {
  return SUBSCRIPTIONS.some((item) => item.id === provider);
}

export function subscription(provider: SubscriptionProviderId): SubscriptionProvider {
  const found = SUBSCRIPTIONS.find((item) => item.id === provider);
  if (!found) throw new Error(`No subscription provider ${provider}`);
  return found;
}

export function providersFile(home: string): string {
  return join(home, "Library", "Application Support", "mailMateAI", "providers.json");
}

export function quotedLoginCommand(binary: string, provider: SubscriptionProviderId): string {
  const spec = subscription(provider);
  return [binary, ...spec.loginArgs].map(shellQuote).join(" ");
}

export function loginShell(command: string, sentinel: string): string {
  const marker = shellQuote(sentinel);
  return `${command} && touch ${marker} && exit 0; printf '\\nSign-in did not finish. This window stays open.\\n'`;
}

export function terminalSignInScript(shellCommand: string): string {
  return `tell application "Terminal"\nactivate\nset theTab to do script ${appleString(shellCommand)}\nreturn theTab\nend tell`;
}

export function terminalTarget(output: string): { windowId: number; tabIndex: number } | undefined {
  const text = output.trim();
  const marker = "tab ";
  const windowMarker = " of window id ";
  if (text.startsWith(marker) && text.includes(windowMarker)) {
    const [tabText, windowText] = text.slice(marker.length).split(windowMarker, 2);
    if (tabText && windowText && /^\d+$/.test(tabText) && /^\d+$/.test(windowText)) {
      return { windowId: Number(windowText), tabIndex: Number(tabText) };
    }
  }
  const parts = text.split(/\s+/);
  if (parts.length === 2 && parts[0] && parts[1] && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
    return { windowId: Number(parts[0]), tabIndex: Number(parts[1]) };
  }
  return undefined;
}

export function closeTerminalScript(windowId: number): string {
  return (
    'tell application "Terminal"\n' +
    "  try\n" +
    `    set theWindow to window id ${windowId}\n` +
    "  on error\n" +
    "    return\n" +
    "  end try\n" +
    "  repeat 20 times\n" +
    "    try\n" +
    "      if not busy of selected tab of theWindow then exit repeat\n" +
    "    on error\n" +
    "      return\n" +
    "    end try\n" +
    "    delay 0.25\n" +
    "  end repeat\n" +
    "  try\n" +
    "    close theWindow\n" +
    "  end try\n" +
    "end tell\n"
  );
}

export function readProviders(home: string): Record<string, ProviderGrant> {
  return parseProviders(readProviderText(home));
}

export function parseProviders(raw: string): Record<string, ProviderGrant> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const grants: Record<string, ProviderGrant> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      const method = record.method;
      grants[key] = {
        authorized: record.authorized === true,
        method: typeof method === "string" ? method : null,
        ...(typeof record.testedAt === "string" ? { testedAt: record.testedAt } : {}),
      };
    }
    return grants;
  } catch {
    return {};
  }
}

export function subscriptionAuthorized(provider: SubscriptionProviderId, home: string): boolean {
  return readProviders(home)[subscription(provider).grantKey]?.authorized === true;
}

export function authorizeGrant(provider: SubscriptionProviderId, home: string, now = new Date()): ProviderGrant {
  const grants = readProviders(home);
  const grant: ProviderGrant = {
    authorized: true,
    method: "login",
    testedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  grants[subscription(provider).grantKey] = grant;
  writeProviders(home, grants);
  return grant;
}

export function forgetGrant(provider: SubscriptionProviderId, home: string): ProviderGrant {
  const grants = readProviders(home);
  const key = subscription(provider).grantKey;
  const current = grants[key] ?? { authorized: false, method: null };
  const grant: ProviderGrant = { ...current, authorized: false, method: null };
  grants[key] = grant;
  writeProviders(home, grants);
  return grant;
}

export function claudeLoginView(stdout: string): { loggedIn: boolean; email: string; subscription: string } {
  try {
    const payload = JSON.parse(stdout) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { loggedIn: false, email: "", subscription: "" };
    }
    const record = payload as Record<string, unknown>;
    return {
      loggedIn: record.loggedIn === true,
      email: typeof record.email === "string" ? record.email : "",
      subscription: typeof record.subscriptionType === "string" ? record.subscriptionType : "",
    };
  } catch {
    return { loggedIn: false, email: "", subscription: "" };
  }
}

export function claudeAccountLine(view: { loggedIn: boolean; email: string; subscription: string }): string {
  if (!view.loggedIn) return "Claude is not signed in. Use Sign in, then Test.";
  if (view.email && view.subscription) {
    return `Signed in to Claude ${capitalize(view.subscription)} as ${view.email}.`;
  }
  if (view.email) return `Signed in as ${view.email}.`;
  if (view.subscription) return `Signed in to Claude ${capitalize(view.subscription)}.`;
  return "Authorized with the Claude subscription.";
}

export function chatgptLoginView(text: string): { ok: true } | { ok: false; error: string } {
  const lower = text.toLowerCase();
  if (lower.includes("logged in using chatgpt")) return { ok: true };
  if (["api key", "access token", "bedrock"].some((word) => lower.includes(word))) {
    return {
      ok: false,
      error: "Codex is signed in with an API key. Sign in with the ChatGPT subscription, then Add.",
    };
  }
  return { ok: false, error: "ChatGPT is not signed in. Use Sign in, then Add." };
}

export function grokLoginView(code: number, output: string): { ok: true } | { ok: false; error: string } {
  const lower = output.toLowerCase();
  if (code !== 0 || lower.includes("unauthenticated")) {
    if (["auth", "login", "sign in", "unauthenticated"].some((word) => lower.includes(word))) {
      return { ok: false, error: "Grok is not signed in. Use Sign in, then Test." };
    }
    const detail = output.trim();
    return { ok: false, error: detail || "grok models failed." };
  }
  return { ok: true };
}

export function authorizedAccountLine(provider: SubscriptionProviderId, detail?: string): string {
  if (detail) return detail;
  return `Authorized with the ${subscription(provider).title} subscription.`;
}

export async function runSubscriptionSignIn(input: {
  provider: SubscriptionProviderId;
  binary: string;
  home: string;
  signal?: AbortSignal;
  openTerminal?: (script: string) => Promise<string>;
  runStatus?: (binary: string, args: string[]) => Promise<CommandCapture>;
  now?: Date;
  exists?: (path: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}): Promise<{ grantPath: string; account: string }> {
  const directory = mkdtempSync(join(tmpdir(), "personal-ai-login-"));
  const sentinel = join(directory, "done");
  const command = quotedLoginCommand(input.binary, input.provider);
  const script = terminalSignInScript(loginShell(command, sentinel));
  const openTerminal = input.openTerminal ?? openMacTerminal;
  const runStatus = input.runStatus ?? ((binary, args) => captureCommand(binary, args, input.home));
  const exists = input.exists ?? existsSync;
  const sleep = input.sleep ?? delay;
  const timeoutMs = input.timeoutMs ?? LOGIN_TIMEOUT_MS;
  try {
    const opened = await openTerminal(script);
    await waitForSentinel(sentinel, exists, sleep, timeoutMs, input.signal);
    const account = await confirmSubscriptionLogin(input.provider, input.binary, runStatus);
    authorizeGrant(input.provider, input.home, input.now);
    const target = terminalTarget(opened);
    if (target) await openTerminal(closeTerminalScript(target.windowId)).catch(() => undefined);
    return { grantPath: providersFile(input.home), account };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function confirmSubscriptionLogin(
  provider: SubscriptionProviderId,
  binary: string,
  runStatus: (binary: string, args: string[]) => Promise<CommandCapture>,
): Promise<string> {
  const spec = subscription(provider);
  if (provider === "xai") {
    const result = await runStatus(binary, ["models"]);
    const view = grokLoginView(result.code, `${result.stdout}\n${result.stderr}`);
    if (!view.ok) throw new Error(view.error);
    return authorizedAccountLine(provider);
  }
  const args = spec.statusArgs ?? [];
  const result = await runStatus(binary, args);
  const text = `${result.stdout}\n${result.stderr}`;
  if (provider === "anthropic") {
    const view = claudeLoginView(result.stdout);
    if (result.code !== 0 || !view.loggedIn) throw new Error("Claude is not signed in. Use Sign in, then Test.");
    return claudeAccountLine(view);
  }
  const view = chatgptLoginView(text);
  if (!view.ok) throw new Error(view.error);
  return authorizedAccountLine(provider);
}

export function openMacTerminal(script: string): Promise<string> {
  return runOsascript(script);
}

export function captureCommand(binary: string, args: string[], home?: string): Promise<CommandCapture> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: commandEnv(binary, undefined, home),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function writeProviders(home: string, grants: Record<string, ProviderGrant>): void {
  const path = providersFile(home);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.providers.json.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(grants, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}

function readProviderText(home: string): string {
  try {
    return readFileSync(providersFile(home), "utf8");
  } catch {
    return "";
  }
}

function appleString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function capitalize(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

async function waitForSentinel(
  sentinel: string,
  exists: (path: string) => boolean,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new Error("Sign-in cancelled.");
    if (exists(sentinel)) return;
    await sleep(LOGIN_POLL_MS);
  }
  throw new Error("Sign-in did not finish. The Terminal window stays open.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOsascript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", () => {
      const fallback = spawn("osascript", ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      let fallbackError = "";
      fallback.stderr.setEncoding("utf8");
      fallback.stderr.on("data", (chunk: string) => {
        fallbackError += chunk;
      });
      fallback.on("error", (error) => reject(error));
      fallback.on("close", (code) => {
        if (code === 0) resolve("");
        else reject(new Error(fallbackError.trim() || "Could not open Terminal for sign-in."));
      });
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || "Could not open Terminal for sign-in."));
    });
  });
}
