import { type SavedPrompt } from "./types";

export function parsePrompts(raw: string | undefined): SavedPrompt[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedPrompt).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function serializePrompts(prompts: SavedPrompt[]): string {
  return JSON.stringify(prompts);
}

function isSavedPrompt(value: unknown): value is SavedPrompt {
  if (!value || typeof value !== "object") return false;
  const prompt = value as Partial<SavedPrompt>;
  return (
    typeof prompt.id === "string" &&
    typeof prompt.name === "string" &&
    typeof prompt.body === "string" &&
    typeof prompt.updatedAt === "number"
  );
}
