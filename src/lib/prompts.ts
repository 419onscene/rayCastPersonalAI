import { LocalStorage } from "@raycast/api";
import { parsePrompts, serializePrompts } from "./prompt-json";
import { type SavedPrompt } from "./types";

const STORAGE_KEY = "saved-prompts";

export { parsePrompts, serializePrompts };

export async function loadPrompts(): Promise<SavedPrompt[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  return parsePrompts(raw);
}

export async function createPrompt(name: string, body: string): Promise<SavedPrompt> {
  const prompts = await loadPrompts();
  const prompt: SavedPrompt = {
    id: crypto.randomUUID(),
    name: name.trim(),
    body: body.trim(),
    updatedAt: Date.now(),
  };
  prompts.unshift(prompt);
  await LocalStorage.setItem(STORAGE_KEY, serializePrompts(prompts));
  return prompt;
}

export async function updatePrompt(id: string, name: string, body: string): Promise<void> {
  const prompts = await loadPrompts();
  const next = prompts.map((prompt) =>
    prompt.id === id ? { ...prompt, name: name.trim(), body: body.trim(), updatedAt: Date.now() } : prompt,
  );
  await LocalStorage.setItem(STORAGE_KEY, serializePrompts(next));
}

export async function deletePrompt(id: string): Promise<void> {
  const prompts = await loadPrompts();
  await LocalStorage.setItem(STORAGE_KEY, serializePrompts(prompts.filter((prompt) => prompt.id !== id)));
}
