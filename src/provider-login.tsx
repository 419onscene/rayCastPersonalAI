import { Action, ActionPanel, Detail, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { homedir } from "os";
import { useEffect, useRef, useState } from "react";
import { resolveCliBinary } from "./lib/binaries";
import { cliPathFor, readPreferences } from "./lib/preferences";
import {
  providersFile,
  quotedLoginCommand,
  runSubscriptionSignIn,
  subscription,
  type SubscriptionProviderId,
} from "./lib/subscription-login";
import { showSubscriptionAccount } from "./oauth-clients";

export function ProviderLogin(props: { provider: SubscriptionProviderId; onSaved: () => void }) {
  const provider = subscription(props.provider);
  const [phase, setPhase] = useState<"ready" | "waiting" | "saved" | "failed">("ready");
  const [detail, setDetail] = useState("");
  const [account, setAccount] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { pop } = useNavigation();
  const preferences = readPreferences();
  const home = homedir();
  const command = quotedLoginCommand(provider.command, props.provider);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function signIn() {
    const resolved = resolveCliBinary({
      command: provider.command,
      preferencePath: cliPathFor(preferences, provider.command),
      home,
    });
    if ("error" in resolved) {
      setDetail(resolved.error);
      setPhase("failed");
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPhase("waiting");
    setDetail(
      `Opening Terminal for ${command}. Finish the subscription login there. This screen stays open until the grant is saved.`,
    );
    try {
      const result = await runSubscriptionSignIn({
        provider: props.provider,
        binary: resolved.path,
        home,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      await showSubscriptionAccount(props.provider);
      props.onSaved();
      setAccount(result.account);
      setPhase("saved");
      await showToast({
        style: Toast.Style.Success,
        title: "Credential Saved",
        message: result.account,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setDetail(caught instanceof Error ? caught.message : "Sign-in failed.");
      setPhase("failed");
    }
  }

  if (phase !== "ready") {
    const markdown =
      phase === "saved"
        ? `## Credential saved\n\n${account}\n\nThe grant is stored at \`${providersFile(home)}\` under \`${provider.grantKey}\`, with method \`login\`.\n\nRaycast settings shows this account.`
        : phase === "failed"
          ? `## Sign-in stopped\n\n${detail}`
          : `## Waiting for ${provider.title}\n\n${detail}`;
    return (
      <Detail
        isLoading={phase === "waiting"}
        markdown={markdown}
        navigationTitle={`Sign In to ${provider.title}`}
        actions={
          <ActionPanel>
            {phase === "saved" ? <Action title="Done" icon={Icon.Check} onAction={pop} /> : null}
            {phase === "failed" ? (
              <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={() => void signIn()} />
            ) : null}
          </ActionPanel>
        }
      />
    );
  }

  return (
    <Form
      navigationTitle={`Sign In to ${provider.title}`}
      actions={
        <ActionPanel>
          <Action title="Sign in" icon={Icon.Terminal} onAction={() => void signIn()} />
        </ActionPanel>
      }
    >
      <Form.Description
        title={provider.title}
        text="Raycast settings cannot open this login. Sign In opens Terminal for the subscription CLI. Finish the login there. This screen records the grant when the CLI exits successfully."
      />
      <Form.Description title="Command" text={command} />
      <Form.Description
        title="Credential"
        text={`Saved at ${providersFile(home)} under ${provider.grantKey}, with method login. Raycast settings then shows this account.`}
      />
    </Form>
  );
}
