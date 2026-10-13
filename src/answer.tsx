import { Action, ActionPanel, Detail, Icon, openExtensionPreferences } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { generateReply, type GenerateInput } from "./lib/providers";
import { renderReply } from "./lib/render-reply";
import { PROVIDER_LABEL } from "./lib/types";

const QUIET_AFTER_MS = 2500;

export function Answer(props: GenerateInput) {
  const [thinkingText, setThinkingText] = useState("");
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [status, setStatus] = useState("");
  const [quiet, setQuiet] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastActivityRef = useRef(Date.now());

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
    setStatus("");
    setQuiet(false);
    setPending(true);
    lastActivityRef.current = Date.now();

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
        lastActivityRef.current = Date.now();
        setQuiet(false);
        if (delta.kind === "status") {
          setStatus(delta.text);
          return;
        }
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

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      setQuiet(Date.now() - lastActivityRef.current > QUIET_AFTER_MS);
    }, 500);
    return () => clearInterval(timer);
  }, [pending, attempt]);

  const markdown = renderReply({
    thinking: thinkingText,
    answer,
    providerLabel: PROVIDER_LABEL[props.provider],
    model: props.model,
    thinkingLabel: props.thinkingLabel,
    note,
    error,
    stopped: stopped && !error,
    pending,
    status,
    quiet,
  });
  const copyText = answer || thinkingText;
  const showPreferences = Boolean(error && /preferences|shortcut|isn't available|couldn't be started/i.test(error));
  const activity = activityText(pending, status, quiet, Boolean(answer || thinkingText));

  return (
    <Detail
      isLoading={pending}
      markdown={markdown}
      navigationTitle="Reply"
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Provider" text={PROVIDER_LABEL[props.provider]} />
          <Detail.Metadata.Label title="Model" text={props.model || "Shortcut"} />
          <Detail.Metadata.Label title="Thinking" text={props.thinkingLabel} />
          <Detail.Metadata.Label title={pending ? "Activity" : "Status"} text={activity} />
        </Detail.Metadata>
      }
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

function activityText(pending: boolean, status: string, quiet: boolean, started: boolean): string {
  if (pending && status) return status;
  if (pending && quiet && started) return "Waiting for the process to continue…";
  if (pending && started) return "Still writing…";
  if (pending) return "Waiting for a reply…";
  return "Finished";
}
