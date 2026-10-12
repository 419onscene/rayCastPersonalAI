import { LocalStorage } from "@raycast/api";
import { accountHome } from "./account-name";

const STORAGE_KEY = "account-name";

export async function loadAccountName(): Promise<string> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  return typeof raw === "string" ? raw : "";
}

export async function saveAccountName(name: string): Promise<string> {
  const next = name.trim();
  await LocalStorage.setItem(STORAGE_KEY, next);
  return next;
}

export async function savedAccountHome(): Promise<string | undefined> {
  return accountHome(await loadAccountName());
}
