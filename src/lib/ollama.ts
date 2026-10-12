import { commandEnv } from "./binaries";
import { runCommand } from "./process";

export interface OllamaThinking {
  values: string[];
  defaultValue?: string;
  reported: boolean;
}

const GPT_OSS_LEVELS = ["low", "medium", "high"];

export function parseOllamaList(stdout: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const name = trimmed.split(/\s+/)[0];
    if (!name || name.toLowerCase() === "name") continue;
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function ollamaThinkingFromOutput(model: string, stdout: string): OllamaThinking {
  const parsed = parseThinkingJson(stdout);
  if (parsed) {
    return {
      values: parsed.values,
      defaultValue:
        parsed.defaultValue && parsed.values.includes(parsed.defaultValue) ? parsed.defaultValue : parsed.values[0],
      reported: true,
    };
  }
  if (isGptOss(model)) {
    return { values: GPT_OSS_LEVELS, defaultValue: "medium", reported: true };
  }
  return { values: [], reported: false };
}

export async function listOllamaModels(binary: string, host: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runCommand(binary, ["list"], { signal, env: ollamaEnv(binary, host) });
  return parseOllamaList(result.stdout);
}

export async function readOllamaThinking(
  binary: string,
  model: string,
  host: string,
  signal?: AbortSignal,
): Promise<OllamaThinking> {
  const env = ollamaEnv(binary, host);
  let stdout = "";
  try {
    stdout = (await runCommand(binary, ["show", model, "--format", "json"], { signal, env })).stdout;
  } catch (error) {
    if (signal?.aborted) throw error;
    stdout = (await runCommand(binary, ["show", model], { signal, env })).stdout;
  }
  return ollamaThinkingFromOutput(model, stdout);
}

export function ollamaEnv(binary: string, host: string): NodeJS.ProcessEnv {
  const trimmed = host.trim();
  return commandEnv(binary, trimmed ? { OLLAMA_HOST: trimmed } : undefined);
}

function isGptOss(model: string): boolean {
  return model.trim().toLowerCase().startsWith("gpt-oss");
}

function parseThinkingJson(stdout: string): { values: string[]; defaultValue?: string } | undefined {
  const json = extractJson(stdout);
  if (!json) return undefined;
  const thinking = findThinking(json);
  if (!thinking) return undefined;
  const rawValues = Array.isArray(thinking.values) ? thinking.values : [];
  const values = rawValues.flatMap((value) => {
    const level = normalizeLevel(value);
    return level ? [level] : [];
  });
  const unique = [...new Set(values)];
  if (unique.length === 0) return { values: [] };
  const defaultValue = normalizeLevel(thinking.default);
  return { values: unique, defaultValue };
}

function extractJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  const start = trimmed.indexOf("{");
  if (start === -1) return undefined;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return undefined;
  }
}

function findThinking(value: unknown): { values?: unknown; default?: unknown } | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findThinking(item);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const thinking = record.thinking;
  if (thinking && typeof thinking === "object" && !Array.isArray(thinking) && "values" in thinking) {
    return thinking as { values?: unknown; default?: unknown };
  }
  for (const nested of Object.values(record)) {
    const found = findThinking(nested);
    if (found) return found;
  }
  return undefined;
}

function normalizeLevel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^(false|true|off|none|null)$/i.test(trimmed)) return undefined;
  return trimmed;
}
