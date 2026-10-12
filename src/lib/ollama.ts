export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim() || "http://127.0.0.1:11434";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Ollama base URL “${trimmed}” is not a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Ollama base URL must start with http:// or https://.");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function ollamaApiUrl(baseUrl: string, path: string): string {
  const root = normalizeBaseUrl(baseUrl);
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function listOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<string[]> {
  const root = normalizeBaseUrl(baseUrl);
  let response: Response;
  try {
    response = await fetch(ollamaApiUrl(root, "/api/tags"), { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      `Ollama isn't running at ${root}. Start it with \`ollama serve\`, or change the base URL in preferences.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama at ${root} returned ${response.status} when listing models.`);
  }
  const payload = (await response.json()) as { models?: { name?: string }[] };
  return (payload.models ?? []).flatMap((model) => (model.name ? [model.name] : []));
}
