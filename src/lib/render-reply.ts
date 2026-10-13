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
  status?: string;
  quiet?: boolean;
}

export function renderReply(state: ReplyView): string {
  const model = state.model || "Shortcut";
  const parts = [`**${state.providerLabel} · ${model} · thinking ${state.thinkingLabel}**`];

  if (state.error && !state.answer && !state.thinking) {
    parts.push(`**Couldn't get a reply**\n\n${state.error}`);
  } else {
    if (state.thinking) parts.push(`**Thinking**\n\n${state.thinking}`);
    if (state.answer) parts.push(state.answer);
    if (state.pending) parts.push(waitingLine(state));
    else if (state.error) parts.push(`**The reply stopped with an error**\n\n${state.error}`);
    else if (state.stopped) parts.push("_Stopped._");
    else if (!state.answer) {
      parts.push(
        state.thinking ? "_The model returned thinking but no reply._" : "_The model returned an empty reply._",
      );
    }
  }

  if (state.note) parts.push(`_${state.note}_`);
  return parts.join("\n\n");
}

function waitingLine(state: ReplyView): string {
  if (state.status) return `_${state.status}_`;
  if (state.quiet && (state.answer || state.thinking)) return "_Waiting for the process to continue…_";
  if (state.answer || state.thinking) return "_Still writing…_";
  return "_Waiting for a reply…_";
}
