import { offeredLevel, thinkingCatalog } from "./thinking";
import { type CliName, type ProviderId } from "./types";

export interface ProviderCommand {
  command: CliName;
  args: string[];
}

export function buildProviderCommand(input: {
  provider: Exclude<ProviderId, "apple">;
  model: string;
  thinking: string;
  prompt: string;
  ollamaLevels?: string[];
}): ProviderCommand {
  const level = allowedLevel(input);
  if (input.provider === "anthropic") return { command: "claude", args: claudeArgs(input.model, input.prompt, level) };
  if (input.provider === "openai") return { command: "codex", args: codexArgs(input.model, input.prompt, level) };
  if (input.provider === "xai") return { command: "grok", args: grokArgs(input.model, input.prompt, level) };
  return { command: "ollama", args: ollamaArgs(input.model, input.prompt, level) };
}

function allowedLevel(input: {
  provider: Exclude<ProviderId, "apple">;
  model: string;
  thinking: string;
  ollamaLevels?: string[];
}): string | undefined {
  if (input.provider === "ollama") {
    const levels = input.ollamaLevels ?? [];
    const thinking = input.thinking.trim();
    if (!thinking || thinking === "off" || thinking === "none") return undefined;
    return levels.includes(thinking) ? thinking : undefined;
  }
  return offeredLevel(thinkingCatalog(input.provider, input.model), input.thinking);
}

function claudeArgs(model: string, prompt: string, effort?: string): string[] {
  const args = [
    "-p",
    prompt,
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    "",
  ];
  if (effort) args.push("--effort", effort);
  return args;
}

function codexArgs(model: string, prompt: string, effort?: string): string[] {
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--json", "-m", model];
  if (effort) args.push("--config", `model_reasoning_effort="${effort}"`);
  args.push("--", prompt);
  return args;
}

function grokArgs(model: string, prompt: string, effort?: string): string[] {
  const args = ["-p", prompt, "--model", model, "--output-format", "streaming-json", "--max-turns", "1"];
  if (effort) args.push("--effort", effort);
  return args;
}

function ollamaArgs(model: string, prompt: string, think?: string): string[] {
  const args = ["run", model, "--nowordwrap"];
  if (think) args.push(`--think=${think}`);
  args.push("--", prompt);
  return args;
}
