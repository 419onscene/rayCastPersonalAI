import { type ProviderId } from "./types";

export const PROMPT_HELP =
  "Pick a saved prompt to start from it. Anything you type here is added after that template. Claude, ChatGPT, and Grok sign in from Add AI. That screen opens Terminal for the subscription CLI and keeps the grant.";

export function askableProviders(input: {
  claude: boolean;
  chatgpt: boolean;
  grok: boolean;
  includeLocal?: ProviderId;
}): ProviderId[] {
  const ids: ProviderId[] = [];
  if (input.claude) ids.push("anthropic");
  if (input.chatgpt) ids.push("openai");
  if (input.grok) ids.push("xai");
  if ((input.includeLocal === "ollama" || input.includeLocal === "apple") && !ids.includes(input.includeLocal)) {
    ids.push(input.includeLocal);
  }
  return ids;
}

export const ADD_SAVED_PROMPT = "add-new";

export function savedPromptOptions(prompts: { id: string; name: string }[]): { value: string; title: string }[] {
  return [
    { value: "none", title: "None" },
    ...prompts.map((prompt) => ({ value: prompt.id, title: prompt.name })),
    { value: ADD_SAVED_PROMPT, title: "Add New" },
  ];
}

export function withCreatedPrompt<T extends { id: string }>(current: T[], created: T): T[] {
  return [created, ...current.filter((item) => item.id !== created.id)];
}

export function initialProvider(
  available: ProviderId[],
  launched: ProviderId | undefined,
  preferred: ProviderId,
): ProviderId {
  if (launched && available.includes(launched)) return launched;
  if (available.includes(preferred)) return preferred;
  return available[0] ?? preferred;
}
