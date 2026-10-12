export function formatHttpError(status: number, body: string, providerLabel: string): string {
  const detail = extractErrorMessage(body);
  if (status === 401 || status === 403) {
    return `${providerLabel} rejected the API key (${status}). Check the password in Raycast extension preferences. ${detail}`.trim();
  }
  if (status === 404) {
    return `${providerLabel} could not find that model (${status}). ${detail}`.trim();
  }
  return `${providerLabel} returned ${status}. ${detail}`.trim();
}

export function extractErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const message = messageFromJson(parsed);
    if (message) return clip(message);
  } catch {
    // The provider returned plain text.
  }
  return clip(trimmed);
}

function messageFromJson(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const nested = error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return undefined;
}

function clip(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}

export function formatNetworkError(error: unknown, target: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message)) return message;
  return `Couldn't reach ${target}. ${message}`;
}
