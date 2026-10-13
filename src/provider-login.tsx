import { Action, ActionPanel, Detail, Form, Icon, open, showToast, Toast, useNavigation } from "@raycast/api";
import { homedir } from "os";
import { useEffect, useRef, useState } from "react";
import { accountHome, detectedAccountName } from "./lib/account-name";
import { loadAccountName, saveAccountName } from "./lib/account-store";
import { resolveCliBinary } from "./lib/binaries";
import {
  credentialState,
  loginUrls,
  runCliLogin,
  terminalLoginAppleScript,
  terminalLoginCommand,
} from "./lib/cli-login";
import { saveAddedAi } from "./lib/connections";
import { cliPathFor, readPreferences } from "./lib/preferences";
import { runCommand } from "./lib/process";
import { CLI_COMMAND, PROVIDER_LABEL, type CliName, type ProviderId } from "./lib/types";

export function ProviderLogin(props: { provider: ProviderId; initialAccountName?: string; onSaved: () => void }) {
  const label = PROVIDER_LABEL[props.provider];
  const command = CLI_COMMAND[props.provider];
  const browserLogin = props.provider === "anthropic" || props.provider === "openai" || props.provider === "xai";
  const [accountName, setAccountName] = useState(props.initialAccountName ?? "");
  const [ready, setReady] = useState(Boolean(props.initialAccountName));
  const [phase, setPhase] = useState<"form" | "waiting" | "saved" | "failed">("form");
  const [output, setOutput] = useState("");
  const [failure, setFailure] = useState("");
  const [session, setSession] = useState<{ binary: string; home: string }>();
  const abortRef = useRef<AbortController | null>(null);
  const openedUrls = useRef(new Set<string>());
  const { pop } = useNavigation();

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (props.initialAccountName) return;
    let cancelled = false;
    loadAccountName()
      .then((saved) => {
        if (!cancelled) setAccountName(saved.trim() || detectedAccountName(homedir()));
      })
      .catch(() => {
        if (!cancelled) setAccountName(detectedAccountName(homedir()));
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [props.initialAccountName]);

  function noteOutput(chunk: string) {
    setOutput((current) => (current + chunk).slice(-6000));
    for (const url of loginUrls(chunk)) {
      if (openedUrls.current.has(url)) continue;
      openedUrls.current.add(url);
      void open(url);
    }
  }

  async function remember(home: string) {
    await saveAccountName(accountName);
    await saveAddedAi({
      provider: props.provider,
      accountName: accountName.trim(),
      signedInAt: Date.now(),
    });
    props.onSaved();
    setPhase("saved");
    await showToast({
      style: Toast.Style.Success,
      title: "Credential Saved",
      message: `${label} is signed in for ${home}.`,
    });
  }

  async function handleSignIn() {
    const home = accountHome(accountName);
    if (!home) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Account Name Needed",
        message: "Enter the short name of this Mac account, the folder name inside /Users.",
      });
      return;
    }
    const preferences = readPreferences();
    const resolved = resolveCliBinary({
      command,
      preferencePath: cliPathFor(preferences, command),
      home,
    });
    if ("error" in resolved) {
      await showToast({ style: Toast.Style.Failure, title: `${label} CLI Missing`, message: resolved.error });
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setSession({ binary: resolved.path, home });
    setFailure("");
    setOutput("");

    if (!browserLogin) {
      await remember(home);
      return;
    }

    setPhase("waiting");
    try {
      const existing = await credentialState(resolved.path, command, controller.signal, home);
      if (controller.signal.aborted) return;
      if (existing === "yes") {
        setOutput(`${label} is already signed in. The credential is kept for ${home}.`);
        await remember(home);
        return;
      }
      const result = await runCliLogin({
        binary: resolved.path,
        command,
        home,
        signal: controller.signal,
        onOutput: noteOutput,
      });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setFailure(result.error);
        setPhase("failed");
        return;
      }
      const after = await credentialState(resolved.path, command, controller.signal, home);
      if (controller.signal.aborted) return;
      if (after === "no") {
        setFailure("The CLI finished without storing a credential. Open Terminal and finish the browser sign-in.");
        setPhase("failed");
        return;
      }
      await remember(home);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setFailure(caught instanceof Error ? caught.message : "Sign-in failed.");
      setPhase("failed");
    }
  }

  async function openTerminal() {
    if (!session) return;
    const shellCommand = terminalLoginCommand(session.binary, command, session.home);
    if (!shellCommand) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPhase("waiting");
    setFailure("");
    setOutput(
      "Terminal is open. Finish the browser sign-in there. This screen stays open until the credential is stored.",
    );
    try {
      await runCommand("/usr/bin/osascript", ["-e", terminalLoginAppleScript(shellCommand)], {
        signal: controller.signal,
      });
      const saved = await pollUntilSignedIn(session.binary, command, session.home, controller.signal);
      if (controller.signal.aborted) return;
      if (!saved) {
        setFailure("The credential was not stored. Finish the browser window in Terminal, then try again.");
        setPhase("failed");
        return;
      }
      await remember(session.home);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setFailure(caught instanceof Error ? caught.message : "Terminal could not open the sign-in.");
      setPhase("failed");
    }
  }

  if (phase !== "form") {
    const markdown =
      phase === "saved"
        ? `## Credential saved\n\n${label} is signed in for \`${accountHome(accountName) ?? ""}\`.\n\nAsk uses this login. The CLI keeps the credential on this Mac.`
        : phase === "failed"
          ? `## Sign-in needs another step\n\n${failure}\n\n${output ? `\`\`\`\n${output.trim()}\n\`\`\`` : ""}`
          : `## Finish sign-in\n\n${label} is signing in. Leave this screen open so the CLI can store the credential.\n\n${output ? `\`\`\`\n${output.trim()}\n\`\`\`` : "Waiting for the browser…"}`;
    return (
      <Detail
        isLoading={phase === "waiting"}
        markdown={markdown}
        navigationTitle={`Sign In to ${label}`}
        actions={
          <ActionPanel>
            {phase === "saved" ? <Action title="Done" icon={Icon.Check} onAction={pop} /> : null}
            {phase === "failed" && browserLogin ? (
              <Action title="Open Terminal to Sign In" icon={Icon.Terminal} onAction={() => void openTerminal()} />
            ) : null}
            {phase === "failed" ? (
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={() => setPhase("form")} />
            ) : null}
          </ActionPanel>
        }
      />
    );
  }

  return (
    <Form
      isLoading={!ready}
      navigationTitle={`Add ${label}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={browserLogin ? "Sign In" : `Save ${label}`}
            icon={browserLogin ? Icon.Globe : Icon.Check}
            onSubmit={() => void handleSignIn()}
          />
        </ActionPanel>
      }
    >
      <Form.Description title={label} text={loginHelp(props.provider)} />
      <Form.TextField
        id="accountName"
        title="Mac Account Name"
        placeholder="the short name in /Users"
        value={accountName}
        info="The CLI stores its login under this Mac account. Personal AI remembers the sign-in after it succeeds."
        onChange={setAccountName}
      />
      {props.provider === "apple" ? (
        <Form.Description
          title="Shortcut"
          text={`Ask runs the “${readPreferences().appleShortcutName}” shortcut. Change that name in extension preferences.`}
        />
      ) : null}
    </Form>
  );
}

function loginHelp(provider: ProviderId): string {
  if (provider === "anthropic") {
    return "Sign in with claude auth login. This screen stays open until Claude stores the credential.";
  }
  if (provider === "openai") {
    return "Sign in with codex login. This screen stays open until ChatGPT stores the credential.";
  }
  if (provider === "xai") {
    return "Sign in with grok login. This screen stays open until Grok stores the credential.";
  }
  if (provider === "ollama") {
    return "Ollama runs on this Mac. Saving it checks that the ollama command is installed and remembers it for Ask.";
  }
  return "Apple Intelligence uses your Shortcut. Saving it remembers that shortcut for Ask.";
}

async function pollUntilSignedIn(
  binary: string,
  command: CliName,
  home: string,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const state = await credentialState(binary, command, signal, home);
      if (state === "yes") return true;
    } catch (error) {
      if (signal.aborted) return false;
      throw error;
    }
    await delay(2000, signal);
  }
  return false;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}
