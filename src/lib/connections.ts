import { LocalStorage } from "@raycast/api";
import { parseAddedAis, serializeAddedAis, upsertAddedAi, type AddedAi } from "./connection-json";
import { type ProviderId } from "./types";

const STORAGE_KEY = "added-ais";

export async function loadAddedAis(): Promise<AddedAi[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  return parseAddedAis(raw);
}

export async function saveAddedAi(next: AddedAi): Promise<void> {
  const items = upsertAddedAi(await loadAddedAis(), next);
  await LocalStorage.setItem(STORAGE_KEY, serializeAddedAis(items));
}

export async function removeAddedAi(provider: ProviderId): Promise<void> {
  const items = (await loadAddedAis()).filter((item) => item.provider !== provider);
  await LocalStorage.setItem(STORAGE_KEY, serializeAddedAis(items));
}
