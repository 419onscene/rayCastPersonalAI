import { isProviderId, PROVIDER_LABEL, type ProviderId } from "./types";

export interface AddedAi {
  provider: ProviderId;
  accountName: string;
  signedInAt: number;
}

export function parseAddedAis(raw: unknown): AddedAi[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: AddedAi[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      if (typeof record.provider !== "string" || !isProviderId(record.provider)) continue;
      if (typeof record.accountName !== "string" || !record.accountName.trim()) continue;
      const signedInAt =
        typeof record.signedInAt === "number" && Number.isFinite(record.signedInAt) ? record.signedInAt : 0;
      items.push({ provider: record.provider, accountName: record.accountName.trim(), signedInAt });
    }
    return items;
  } catch {
    return [];
  }
}

export function serializeAddedAis(items: AddedAi[]): string {
  return JSON.stringify(items);
}

export function upsertAddedAi(items: AddedAi[], next: AddedAi): AddedAi[] {
  return [next, ...items.filter((item) => item.provider !== next.provider)];
}

export function signInFirstMessage(provider: ProviderId): string {
  const label = PROVIDER_LABEL[provider];
  return `${label} isn't signed in. Open Add AI, select ${label}, and finish the browser OAuth sign-in. That screen keeps the credential. Raycast settings cannot start the login.`;
}
