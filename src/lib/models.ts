import { commandEnv, resolveCliBinary } from "./binaries";
import { ollamaEnv, parseOllamaList } from "./ollama";
import { commandErrorText, runCommand } from "./process";
import { type CliName, type ProviderId } from "./types";

export interface AccountModel {
  id: string;
  title: string;
  default?: boolean;
  efforts?: { values: string[]; defaultValue?: string; reported: boolean };
}

export interface ModelListResult {
  models: AccountModel[];
  error?: string;
}

export const CLAUDE_MODELS_UNAVAILABLE =
  "Claude Code has no command that lists the models this login can use. The documented picker is the interactive /model command, and the CLI reference has no non-interactive list. This extension will not substitute a built-in model catalog.";

export function modelListInvocation(provider: ProviderId): { command: CliName; args: string[] } | { error: string } {
  if (provider === "anthropic") return { error: CLAUDE_MODELS_UNAVAILABLE };
  if (provider === "apple") return { error: "Apple Intelligence has no model menu." };
  if (provider === "openai") return { command: "codex", args: ["debug", "models"] };
  if (provider === "xai") return { command: "grok", args: ["models"] };
  return { command: "ollama", args: ["list"] };
}

export function emptyModelListMessage(provider: ProviderId): string {
  const invocation = modelListInvocation(provider);
  if ("error" in invocation) return invocation.error;
  const command = `${invocation.command} ${invocation.args.join(" ")}`;
  return `\`${command}\` returned no models. The dropdown stays empty, and no built-in model list is substituted.`;
}

export function parseModelList(provider: ProviderId, stdout: string): AccountModel[] {
  if (provider === "openai") return parseCodexModels(stdout);
  if (provider === "xai") return parseGrokModels(stdout);
  if (provider === "ollama") return parseOllamaList(stdout).map((id) => ({ id, title: id }));
  return [];
}

export function selectAccountModel(models: AccountModel[], defaultModel: string, current?: string): string {
  if (current && models.some((model) => model.id === current)) return current;
  const preferred = defaultModel.trim();
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  return models.find((model) => model.default)?.id ?? models[0]?.id ?? "";
}

export async function listAccountModels(input: {
  provider: ProviderId;
  preferencePath: string;
  ollamaHost: string;
  signal?: AbortSignal;
}): Promise<ModelListResult> {
  if (input.provider === "apple") return { models: [] };
  const invocation = modelListInvocation(input.provider);
  if ("error" in invocation) return { models: [], error: invocation.error };

  const resolved = resolveCliBinary({ command: invocation.command, preferencePath: input.preferencePath });
  if ("error" in resolved) return { models: [], error: resolved.error };

  const env = input.provider === "ollama" ? ollamaEnv(resolved.path, input.ollamaHost) : commandEnv(resolved.path);
  try {
    const result = await runCommand(resolved.path, invocation.args, { signal: input.signal, env });
    const models = parseModelList(input.provider, result.stdout);
    if (models.length === 0) return { models: [], error: emptyModelListMessage(input.provider) };
    return { models };
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const command = `${invocation.command} ${invocation.args.join(" ")}`;
    return {
      models: [],
      error: `\`${command}\` failed. ${commandErrorText(error)} The dropdown stays empty, and no built-in model list is substituted.`,
    };
  }
}

export function parseCodexModels(stdout: string): AccountModel[] {
  const json = parseJson(stdout);
  if (!json) return [];
  const rows = modelRows(json);
  const models: AccountModel[] = [];
  const seen = new Set<string>();
  const sorted = [...rows].sort((left, right) => {
    const leftDefault = isDefault(left) ? 1 : 0;
    const rightDefault = isDefault(right) ? 1 : 0;
    if (leftDefault !== rightDefault) return rightDefault - leftDefault;
    return priority(right) - priority(left);
  });
  for (const row of sorted) {
    if (!isSelectable(row)) continue;
    const id = readString(row.slug) || readString(row.model) || readString(row.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const efforts = readEfforts(row);
    models.push({
      id,
      title: readString(row.display_name) || readString(row.name) || id,
      default: isDefault(row),
      ...(efforts ? { efforts } : {}),
    });
  }
  return models;
}

export function parseGrokModels(stdout: string): AccountModel[] {
  const json = parseJson(stdout);
  const items = json === undefined ? undefined : listedItems(json);
  if (!items) return parseGrokText(stdout);
  const models: AccountModel[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    for (const model of modelFromUnknown(item)) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return models;
}

function parseGrokText(stdout: string): AccountModel[] {
  const models: AccountModel[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*]\s+/, "");
    if (!trimmed) continue;
    const [id, ...rest] = trimmed.split(/\s+/);
    if (!id || /^(model|models|id|name|available)$/i.test(id)) continue;
    if (!/^[A-Za-z0-9_.:@/-]+$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const title = rest
      .join(" ")
      .replace(/^[—–-]\s*/, "")
      .trim();
    models.push({ id, title: title || id });
  }
  return models;
}

function modelRows(json: unknown): Record<string, unknown>[] {
  return (listedItems(json) ?? []).flatMap((item) => (isRecord(item) ? [item] : []));
}

function listedItems(json: unknown): unknown[] | undefined {
  if (Array.isArray(json)) return json;
  if (!isRecord(json)) return undefined;
  for (const key of ["models", "data", "available_models"]) {
    const value = json[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function modelFromUnknown(item: unknown): AccountModel[] {
  if (typeof item === "string") {
    const id = item.trim();
    return id ? [{ id, title: id }] : [];
  }
  if (!isRecord(item) || !isSelectable(item)) return [];
  const id = readString(item.id) || readString(item.model) || readString(item.slug) || readString(item.name);
  if (!id) return [];
  const efforts = readEfforts(item);
  return [
    {
      id,
      title: readString(item.display_name) || readString(item.name) || id,
      ...(efforts ? { efforts } : {}),
    },
  ];
}

function isSelectable(row: Record<string, unknown>): boolean {
  const visibility = readString(row.visibility).toLowerCase();
  if (visibility === "hide" || visibility === "hidden" || visibility === "none") return false;
  if (row.show_in_picker === false || row.user_selectable === false || row.hidden === true) return false;
  return true;
}

function isDefault(row: Record<string, unknown>): boolean {
  return row.is_default === true || row.default === true;
}

function priority(row: Record<string, unknown>): number {
  return typeof row.priority === "number" ? row.priority : 0;
}

function readEfforts(row: Record<string, unknown>): AccountModel["efforts"] | undefined {
  const raw = row.supported_reasoning_levels ?? row.supported_reasoning_efforts ?? row.reasoning_efforts;
  if (!Array.isArray(raw)) return undefined;
  const values = raw.flatMap((item) => {
    const level = normalizeEffort(item);
    return level ? [level] : [];
  });
  const unique = [...new Set(values)];
  const defaultValue = normalizeEffort(
    row.default_reasoning_level ?? row.default_reasoning_effort ?? row.default_effort,
  );
  return {
    values: unique,
    defaultValue: defaultValue && unique.includes(defaultValue) ? defaultValue : unique[0],
    reported: true,
  };
}

function normalizeEffort(value: unknown): string | undefined {
  const raw = isRecord(value) ? (value.effort ?? value.id ?? value.value) : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "off" || trimmed === "none" || trimmed === "false") return undefined;
  return trimmed === "extra_high" || trimmed === "extra-high" ? "xhigh" : trimmed;
}

function parseJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const list = trimmed.indexOf("[");
    const index = start === -1 ? list : list === -1 ? start : Math.min(start, list);
    if (index === -1) return undefined;
    try {
      return JSON.parse(trimmed.slice(index));
    } catch {
      return undefined;
    }
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
