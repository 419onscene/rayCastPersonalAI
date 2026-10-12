export interface ReplyView {
  thinking: string;
  answer: string;
  providerLabel: string;
  model: string;
  thinkingLabel: string;
  note?: string;
  error?: string;
  stopped?: boolean;
  pending: boolean;
}

export function renderReply(state: ReplyView): string {
  const parts: string[] = [];

  if (state.error && !state.answer && !state.thinking) {
    parts.push(`**Couldn't get a reply**\n\n${state.error}`);
  } else {
    if (!state.answer && !state.thinking && state.pending) parts.push("Sending your prompt…");
    if (state.thinking) parts.push(`**Thinking**\n\n${state.thinking}`);
    if (state.answer) parts.push(state.answer);
    else if (state.thinking && state.pending) parts.push("_Writing the reply…_");

    if (state.error) parts.push(`**The reply stopped with an error**\n\n${state.error}`);
    else if (state.stopped) parts.push("_Stopped._");
    else if (!state.pending && !state.answer) {
      parts.push(
        state.thinking ? "_The model returned thinking but no reply._" : "_The model returned an empty reply._",
      );
    }
  }

  const footer = [state.providerLabel, state.model || "Shortcut", `thinking ${state.thinkingLabel}`].join(" · ");
  parts.push(`---\n\n_${footer}_`);
  if (state.note) parts.push(`_${state.note}_`);
  return parts.join("\n\n");
}
