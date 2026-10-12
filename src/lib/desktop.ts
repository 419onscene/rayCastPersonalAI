import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { commandErrorText, runCommand } from "./process";

export const CLAUDE_PROMPT_LIMIT = 14000;
const CHATGPT_URL_LIMIT = 6000;

export function claudeDesktopUrl(prompt: string): { url: string; truncated: boolean } {
  const truncated = prompt.length > CLAUDE_PROMPT_LIMIT;
  const text = truncated ? prompt.slice(0, CLAUDE_PROMPT_LIMIT) : prompt;
  return { url: `claude://claude.ai/new?q=${encodeURIComponent(text)}`, truncated };
}

export function chatgptDesktopUrl(prompt: string): string {
  return `chatgpt://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

export function appleString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function chatGptPasteScript(promptFile: string): string {
  const file = appleString(promptFile);
  return `
set promptText to read (POSIX file ${file}) as «class utf8»
set hadClipboard to true
try
  set previousClipboard to the clipboard
on error
  set hadClipboard to false
end try
set the clipboard to promptText
tell application "ChatGPT" to activate
delay 0.6
try
  tell application "System Events"
    tell process "ChatGPT"
      set frontmost to true
      keystroke "n" using {command down}
      delay 0.4
      keystroke "v" using {command down}
      delay 0.25
    end tell
  end tell
on error errMsg number errNum
  if hadClipboard then
    try
      set the clipboard to previousClipboard
    end try
  end if
  error errMsg number errNum
end try
if hadClipboard then
  try
    set the clipboard to previousClipboard
  end try
end if
`.trim();
}

export async function openClaudeDesktop(prompt: string): Promise<{ truncated: boolean }> {
  await assertMacApp("Claude");
  const target = claudeDesktopUrl(prompt);
  try {
    await runCommand(macTool("open"), [target.url]);
  } catch (error) {
    throw new Error(`Couldn't open Claude. ${commandErrorText(error)}`);
  }
  return { truncated: target.truncated };
}

export async function openChatGptDesktop(prompt: string): Promise<{ method: "paste" | "url"; warning?: string }> {
  await assertMacApp("ChatGPT");
  try {
    await pasteIntoChatGpt(prompt);
    return { method: "paste" };
  } catch (error) {
    const detail = commandErrorText(error);
    await copyToClipboard(prompt).catch(() => undefined);
    if (prompt.length > CHATGPT_URL_LIMIT) {
      throw new Error(chatGptPasteFailure(detail, true));
    }
    try {
      await runCommand(macTool("open"), [chatgptDesktopUrl(prompt)]);
    } catch (openError) {
      throw new Error(
        `${chatGptPasteFailure(detail, true)} Opening the chatgpt:// link also failed. ${commandErrorText(openError)}`,
      );
    }
    return { method: "url", warning: chatGptPasteFailure(detail, false) };
  }
}

async function pasteIntoChatGpt(prompt: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "personal-ai-"));
  const promptFile = join(directory, "prompt.txt");
  try {
    await writeFile(promptFile, prompt, "utf8");
    await runCommand(macTool("osascript"), ["-"], { input: chatGptPasteScript(promptFile) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function copyToClipboard(prompt: string): Promise<void> {
  await runCommand(macTool("pbcopy"), [], { input: prompt });
}

async function assertMacApp(appName: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`Opening ${appName} needs macOS.`);
  }
  try {
    await runCommand(macTool("osascript"), ["-e", `POSIX path of (path to application ${appleString(appName)})`]);
  } catch {
    throw new Error(`${appName} isn't installed. Install the desktop app, then try again.`);
  }
}

function chatGptPasteFailure(detail: string, blocked: boolean): string {
  if (isAccessibilityError(detail)) {
    const next = blocked
      ? "The prompt is on your clipboard."
      : "ChatGPT was opened with a chatgpt:// link instead, and the prompt is on your clipboard.";
    return `macOS blocked typing into ChatGPT. Allow Raycast in System Settings → Privacy & Security → Accessibility, then try again. ${next}`;
  }
  if (blocked) return `Couldn't paste into ChatGPT. The prompt is on your clipboard. ${detail}`;
  return `Opened ChatGPT with a link because pasting into the app failed. If the composer is empty, paste the prompt. ${detail}`;
}

function macTool(name: "open" | "osascript" | "pbcopy"): string {
  return process.platform === "darwin" ? `/usr/bin/${name}` : name;
}

function isAccessibilityError(detail: string): boolean {
  return /not authorized|1002|-1743|assistive|accessibility|not allowed to send keystrokes|system events/i.test(detail);
}
