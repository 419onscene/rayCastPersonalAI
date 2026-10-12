import { Action, ActionPanel, Detail, Icon, openExtensionPreferences } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { generateReply, type GenerateInput } from "./lib/providers";
import { renderReply } from "./lib/render-reply";
import { PROVIDER_LABEL, THINKING_LABEL } from "./lib/types";

export function Answer(props: GenerateInput) {
  const [thinkingText, setThinkingText] = useState("");
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    let thinkingBuffer = "";
    let answerBuffer = "";
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    setThinkingText("");
    setAnswer("");
    setError(undefined);
    setNote(undefined);
    setStopped(false);
    setPending(true);

    const flush = () => {
      if (!active) return;
      setThinkingText(thinkingBuffer);
      setAnswer(answerBuffer);
    };
    const schedule = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = undefined;
        flush();
      }, 40);
    };

    generateReply(props, {
      signal: controller.signal,
      onNote: (next) => {
        if (active) setNote(next);
      },
      onDelta: (delta) => {
        if (delta.kind === "thinking") thinkingBuffer += delta.text;
        else answerBuffer += delta.text;
        schedule();
      },
    })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "The request failed.");
      })
      .finally(() => {
        if (flushTimer) clearTimeout(flushTimer);
        if (!active) return;
        flush();
        setPending(false);
        if (controller.signal.aborted) setStopped(true);
      });

    return () => {
      active = false;
      controller.abort();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [attempt, props]);

  const markdown = renderReply({
    thinking: thinkingText,
    answer,
    providerLabel: PROVIDER_LABEL[props.provider],
    model: props.model,
    thinkingLabel: THINKING_LABEL[props.thinking],
    note,
    error,
    stopped: stopped && !error,
    pending,
  });
  const copyText = answer || thinkingText;
  const showPreferences = Boolean(error && /api key|preferences|shortcut name/i.test(error));

  return (
    <Detail
      isLoading={pending}
      markdown={markdown}
      navigationTitle="Reply"
      actions={
        <ActionPanel>
          {pending ? (
            <Action
              title="Stop"
              icon={Icon.Stop}
              onAction={() => {
                abortRef.current?.abort();
                setStopped(true);
                setPending(false);
              }}
            />
          ) : (
            <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={() => setAttempt((value) => value + 1)} />
          )}
          {copyText ? <Action.CopyToClipboard title="Copy Reply" content={copyText} /> : null}
          {showPreferences ? (
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={() => openExtensionPreferences()} />
          ) : null}
        </ActionPanel>
      }
    />
  );
}
