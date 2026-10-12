import { tmpdir } from "os";
import { runAppleShortcut } from "./apple";
import { commandEnv, resolveCliBinary } from "./binaries";
import { buildProviderCommand } from "./cli-command";
import {
  createOllamaPlainParser,
  deltasFromClaudeLine,
  deltasFromCodexLine,
  deltasFromGrokLine,
  splitLines,
} from "./cli-output";
import { commandErrorText, streamCommand } from "./process";
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
  ollamaLevels: string[];
  claudeCliPath: string;
  codexCliPath: string;
  grokCliPath: string;
  ollamaCliPath: string;
  shortcutsCliPath: string;
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

  if (input.provider === "apple") {
    const binary = resolveOrThrow("shortcuts", input.shortcutsCliPath);
    const text = await runAppleShortcut({
      name: input.appleShortcutName,
      prompt: input.prompt,
      binary,
      signal: handlers.signal,
    });
    if (text) handlers.onDelta({ kind: "text", text });
    return;
  }

  if (!input.model.trim()) {
    throw new Error(input.provider === "ollama" ? "Pick an Ollama model, or set a custom model id." : "Pick a model.");
  }

  const command = buildProviderCommand({
    provider: input.provider,
    model: input.model,
    thinking: input.thinking,
    prompt: input.prompt,
    ollamaLevels: input.ollamaLevels,
  });
  const binary = resolveOrThrow(command.command, preferencePath(input, command.command));
  const env = commandEnv(
    binary,
    input.provider === "ollama" && input.ollamaHost.trim() ? { OLLAMA_HOST: input.ollamaHost.trim() } : undefined,
  );

  try {
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
    if (/enoent/i.test(detail)) {
      throw new Error(`\`${CLI_COMMAND[input.provider]}\` couldn't be started at ${binary}.`);
    }
    throw new Error(detail || `${CLI_COMMAND[input.provider]} failed.`);
  }
}

function emit(deltas: ReplyDelta[], onDelta: (delta: ReplyDelta) => void): void {
  for (const delta of deltas) {
    if (delta.text) onDelta(delta);
  }
}

function resolveOrThrow(command: CliName, preferencePath: string): string {
  const resolved = resolveCliBinary({ command, preferencePath });
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
