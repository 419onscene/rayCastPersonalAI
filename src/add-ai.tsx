import { Action, ActionPanel, Form, Icon, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { homedir } from "os";
import { useEffect, useState } from "react";
import { accountHome, detectedAccountName } from "./lib/account-name";
import { loadAccountName, saveAccountName } from "./lib/account-store";
import { resolveCliBinary } from "./lib/binaries";
import { loginArgs, startCliLogin } from "./lib/cli-login";
import { readPreferences } from "./lib/preferences";
import { type CliName } from "./lib/types";

const SIGN_IN: { command: "claude" | "codex" | "grok"; title: string; label: string }[] = [
  { command: "claude", title: "Sign In to Claude", label: "Claude" },
  { command: "codex", title: "Sign In to ChatGPT", label: "ChatGPT" },
  { command: "grok", title: "Sign In to Grok", label: "Grok" },
];

export default function Command() {
  const preferences = readPreferences();
  const [accountName, setAccountName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAccountName()
      .then((saved) => {
        if (cancelled) return;
        setAccountName(saved.trim() || detectedAccountName(homedir()));
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
  }, []);

  const home = accountHome(accountName);

  async function persistName(): Promise<string | undefined> {
    if (!home) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Account Name Needed",
        message: "Enter the short name of this Mac account, the same name that appears in /Users.",
      });
      return undefined;
    }
    await saveAccountName(accountName);
    return home;
  }

  async function handleSave() {
    const savedHome = await persistName();
    if (!savedHome) return;
    await showToast({
      style: Toast.Style.Success,
      title: "Account Name Saved",
      message: `CLI paths will use ${savedHome}.`,
    });
  }

  async function signIn(command: "claude" | "codex" | "grok", label: string) {
    const savedHome = await persistName();
    if (!savedHome) return;
    const preferencePath = pathFor(command);
    const resolved = resolveCliBinary({ command, preferencePath, home: savedHome });
    if ("error" in resolved) {
      await showToast({ style: Toast.Style.Failure, title: `${label} CLI Missing`, message: resolved.error });
      return;
    }
    startCliLogin(resolved.path, command, savedHome);
    const args = loginArgs(command)?.join(" ") ?? "login";
    await showToast({
      style: Toast.Style.Success,
      title: `${label} Sign-In Started`,
      message: `Finish ${command} ${args} in the browser, then ask again.`,
    });
  }

  async function checkOllama() {
    const savedHome = await persistName();
    if (!savedHome) return;
    const resolved = resolveCliBinary({
      command: "ollama",
      preferencePath: preferences.ollamaCliPath,
      home: savedHome,
    });
    if ("error" in resolved) {
      await showToast({ style: Toast.Style.Failure, title: "Ollama CLI Missing", message: resolved.error });
      return;
    }
    await showToast({
      style: Toast.Style.Success,
      title: "Ollama Is Installed",
      message: `${resolved.path} is ready. Keep the Ollama app running for local models.`,
    });
  }

  function pathFor(command: CliName): string {
    if (command === "claude") return preferences.claudeCliPath;
    if (command === "codex") return preferences.codexCliPath;
    if (command === "grok") return preferences.grokCliPath;
    if (command === "ollama") return preferences.ollamaCliPath;
    return preferences.shortcutsCliPath;
  }

  return (
    <Form
      isLoading={!ready}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Account Name" icon={Icon.Person} onSubmit={handleSave} />
          {SIGN_IN.map((item) => (
            <Action
              key={item.command}
              title={item.title}
              icon={Icon.Globe}
              onAction={() => void signIn(item.command, item.label)}
            />
          ))}
          <Action title="Check Ollama" icon={Icon.CheckCircle} onAction={() => void checkOllama()} />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={() => void openExtensionPreferences()}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Add AI"
        text="Enter this Mac's account name, then sign in to each CLI. Claude, ChatGPT, and Grok open a browser. The login stays in that CLI. Ollama is local. Apple Intelligence uses the shortcut in preferences."
      />
      <Form.TextField
        id="accountName"
        title="Mac Account Name"
        placeholder="the short name in /Users"
        value={accountName}
        info="This replaces <your-user-name> in the CLI path preferences. Ask uses the saved name when it looks up claude, codex, grok, and ollama."
        onChange={setAccountName}
      />
      <Form.Description
        title="Home"
        text={home ? home : "Enter a Mac account name such as the folder name inside /Users."}
      />
      {SIGN_IN.map((item) => (
        <Form.Description
          key={item.command}
          title={item.label}
          text={statusLine(item.command, pathFor(item.command), home)}
        />
      ))}
      <Form.Description title="Ollama" text={statusLine("ollama", preferences.ollamaCliPath, home)} />
      <Form.Description
        title="Apple Intelligence"
        text={`Uses the “${preferences.appleShortcutName}” shortcut through the shortcuts command. Change the shortcut name in extension preferences. There is no separate sign-in.`}
      />
    </Form>
  );
}

function statusLine(command: CliName, preferencePath: string, home: string | undefined): string {
  if (!home) return "Save a Mac account name to look up this CLI.";
  const resolved = resolveCliBinary({ command, preferencePath, home });
  if ("error" in resolved) return "The command was not found in the usual locations. Install it, then try again.";
  if (command === "ollama") return `Found at ${resolved.path}. Local models need the Ollama app running.`;
  return `Found at ${resolved.path}. Sign in to open the browser login.`;
}
