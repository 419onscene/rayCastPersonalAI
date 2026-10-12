import { type ReplyDelta } from "./types";

export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim().length > 0), rest };
}

export function deltasFromClaudeLine(line: string): ReplyDelta[] {
  const json = parseJson(line);
  if (!json) return [];
  if (json.type === "result" && json.subtype === "error") {
    throw new Error(readString(json.error) || readString(json.result) || "Claude Code returned an error.");
  }
  if (json.type !== "stream_event") return [];
  const event = asRecord(json.event);
  const delta = asRecord(event?.delta);
  if (!delta) return [];
  if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
    return [{ kind: "text", text: delta.text }];
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
    return [{ kind: "thinking", text: delta.thinking }];
  }
  return [];
}

export function deltasFromCodexLine(line: string): ReplyDelta[] {
  const json = parseJson(line);
  if (!json) return [];
  if (json.type === "error" || json.type === "turn.failed") {
    throw new Error(readString(json.message) || readString(json.error) || "Codex returned an error.");
  }
  if (json.type !== "item.completed") return [];
  const item = asRecord(json.item);
  if (!item) return [];
  if (item.type === "agent_message" && typeof item.text === "string" && item.text) {
    return [{ kind: "text", text: item.text }];
  }
  if (item.type === "reasoning") {
    const text = readString(item.text) || readString(item.summary);
    if (text) return [{ kind: "thinking", text }];
  }
  return [];
}

export function deltasFromGrokLine(line: string): ReplyDelta[] {
  const json = parseJson(line);
  if (!json) {
    return line.trim().startsWith("{") ? [] : [{ kind: "text", text: line }];
  }
  if (json.type === "error")
    throw new Error(readString(json.message) || readString(json.data) || "Grok returned an error.");
  if (json.type === "text" && typeof json.data === "string" && json.data) return [{ kind: "text", text: json.data }];
  if (json.type === "thought" && typeof json.data === "string" && json.data) {
    return [{ kind: "thinking", text: json.data }];
  }
  if (typeof json.text === "string" && json.text && json.type !== "end") return [{ kind: "text", text: json.text }];
  return [];
}

const OLLAMA_THINKING_OPEN = "Thinking...\n";
const OLLAMA_THINKING_CLOSE = "...done thinking.\n\n";

export function createOllamaPlainParser(onDelta: (delta: ReplyDelta) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = "";
  let mode: "start" | "thinking" | "answer" = "start";

  const emit = (kind: ReplyDelta["kind"], text: string) => {
    if (text) onDelta({ kind, text });
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let advanced = true;
      while (buffer && advanced) {
        advanced = false;
        if (mode === "start") {
          const index = buffer.indexOf(OLLAMA_THINKING_OPEN);
          if (index === -1) {
            if (OLLAMA_THINKING_OPEN.startsWith(buffer)) return;
            mode = "answer";
            advanced = true;
            continue;
          }
          emit("text", buffer.slice(0, index));
          buffer = buffer.slice(index + OLLAMA_THINKING_OPEN.length);
          mode = "thinking";
          advanced = true;
          continue;
        }
        if (mode === "thinking") {
          const index = buffer.indexOf(OLLAMA_THINKING_CLOSE);
          if (index === -1) {
            const keep = OLLAMA_THINKING_CLOSE.length - 1;
            if (buffer.length > keep) {
              emit("thinking", buffer.slice(0, buffer.length - keep));
              buffer = buffer.slice(buffer.length - keep);
            }
            return;
          }
          emit("thinking", buffer.slice(0, index));
          buffer = buffer.slice(index + OLLAMA_THINKING_CLOSE.length);
          mode = "answer";
          advanced = true;
          continue;
        }
        emit("text", buffer);
        buffer = "";
      }
    },
    flush() {
      if (!buffer) return;
      emit(mode === "thinking" ? "thinking" : "text", buffer);
      buffer = "";
    },
  };
}

function parseJson(line: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
