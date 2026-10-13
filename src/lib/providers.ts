import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runAppleShortcut } from "./apple";
import { commandEnv, resolveCliBinary } from "./binaries";
import { ensureSignedIn, isAuthFailure, loginRequiredMessage } from "./cli-login";
import { buildProviderCommand } from "./cli-command";
import {
  createOllamaPlainParser,
  deltasFromClaudeLine,
  deltasFromCodexLine,
  deltasFromGrokLine,
  splitLines,
  stripAnsi,
} from "./cli-output";
import { commandErrorText, streamCommand } from "./process";
import { subscriptionAuthorized } from "./subscription-login";
import { type CliName, CLI_COMMAND, type ProviderId, type ReplyDelta } from "./types";

export interface GenerateInput {
  provider: ProviderId;
  model: string;
  thinking: string;
  thinkingLabel: string;
  note?: string;
  prompt: string;
  appleShortcutName: string;
  ollamaHost: string;
  thinkingLevels: string[];
  listError?: string;
  claudeCliPath: string;
  codexCliPath: string;
  grokCliPath: string;
  ollamaCliPath: string;
  shortcutsCliPath: string;
  home?: string;
}

export async function generateReply(
  input: GenerateInput,
  handlers: {
    signal: AbortSignal;
    onDelta: (delta: ReplyDelta) => void;
    onNote: (note: string | undefined) => void;
  },
): Promise<void> {
  handlers.onNote(input.note);
  if (input.listError) throw new Error(input.listError);

  if (input.provider === "apple") {
    const binary = resolveOrThrow("shortcuts", input.shortcutsCliPath, input.home);
    const text = await runAppleShortcut({
      name: input.appleShortcutName,
      prompt: input.prompt,
      binary,
      signal: handlers.signal,
    });
    if (text) handlers.onDelta({ kind: "text", text });
    return;
  }

  if (input.provider !== "anthropic" && !input.model.trim()) {
    throw new Error("Pick a model from the account list.");
  }

  if (input.provider === "xai" && input.home && !subscriptionAuthorized("xai", input.home)) {
    throw new Error(loginRequiredMessage("grok"));
  }

  let promptFile: string | undefined;
  let binary = "";
  let commandName: CliName = CLI_COMMAND[input.provider];
  try {
    if (input.provider === "xai") promptFile = writeGrokPrompt(input.prompt);
    const command = buildProviderCommand({
      provider: input.provider,
      model: input.model,
      thinking: input.thinking,
      prompt: promptFile ?? input.prompt,
      thinkingLevels: input.thinkingLevels,
    });
    binary = resolveOrThrow(command.command, preferencePath(input, command.command), input.home);
    commandName = command.command;
    const signedIn = await ensureSignedIn(binary, command.command, handlers.signal, input.home);
    if (signedIn) throw new Error(signedIn);
    const env = commandEnv(
      binary,
      input.provider === "ollama" && input.ollamaHost.trim() ? { OLLAMA_HOST: input.ollamaHost.trim() } : undefined,
      input.home,
    );

    if (input.provider === "xai" && promptFile) {
      await streamCommand(binary, command.args, {
        signal: handlers.signal,
        cwd: tmpdir(),
        env,
        input: input.prompt,
        onStdout: (chunk) => {
          const text = stripAnsi(chunk);
          if (text) handlers.onDelta({ kind: "text", text });
        },
      });
      return;
    }

    if (input.provider === "ollama") {
      const parser = createOllamaPlainParser(handlers.onDelta);
      await streamCommand(binary, command.args, {
        signal: handlers.signal,
        cwd: tmpdir(),
        env,
        onStdout: parser.push,
      });
      parser.flush();
      return;
    }

    const mapLine =
      input.provider === "anthropic"
        ? deltasFromClaudeLine
        : input.provider === "openai"
          ? deltasFromCodexLine
          : deltasFromGrokLine;
    let rest = "";
    await streamCommand(binary, command.args, {
      signal: handlers.signal,
      cwd: tmpdir(),
      env,
      onStdout: (chunk) => {
        const parsed = splitLines(rest + chunk);
        rest = parsed.rest;
        for (const line of parsed.lines) emit(mapLine(line), handlers.onDelta);
      },
    });
    if (rest.trim()) emit(mapLine(rest), handlers.onDelta);
  } catch (error) {
    if (handlers.signal.aborted) throw error;
    const detail = commandErrorText(error);
    if (isAuthFailure(detail)) {
      throw new Error(loginRequiredMessage(commandName));
    }
    if (/enoent/i.test(detail)) {
      throw new Error(`\`${CLI_COMMAND[input.provider]}\` couldn't be started at ${binary}.`);
    }
    throw new Error(detail || `${CLI_COMMAND[input.provider]} failed.`);
  } finally {
    if (promptFile) rmSync(join(promptFile, ".."), { recursive: true, force: true });
  }
}

function writeGrokPrompt(prompt: string): string {
  const directory = mkdtempSync(join(tmpdir(), "personal-ai-grok-"));
  const path = join(directory, "prompt.txt");
  writeFileSync(path, prompt, { encoding: "utf8", mode: 0o600 });
  return path;
}

function emit(deltas: ReplyDelta[], onDelta: (delta: ReplyDelta) => void): void {
  for (const delta of deltas) {
    if (delta.text) onDelta(delta);
  }
}

function resolveOrThrow(command: CliName, preferencePath: string, home?: string): string {
  const resolved = resolveCliBinary({ command, preferencePath, home });
  if ("error" in resolved) throw new Error(resolved.error);
  return resolved.path;
}

function preferencePath(input: GenerateInput, command: CliName): string {
  if (command === "claude") return input.claudeCliPath;
  if (command === "codex") return input.codexCliPath;
  if (command === "grok") return input.grokCliPath;
  if (command === "ollama") return input.ollamaCliPath;
  return input.shortcutsCliPath;
}
