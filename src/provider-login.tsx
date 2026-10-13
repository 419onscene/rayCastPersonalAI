import { Action, ActionPanel, Detail, Form, Icon, open, showToast, Toast, useNavigation } from "@raycast/api";
import { homedir } from "os";
import { useEffect, useRef, useState } from "react";
import { detectedAccountName } from "./lib/account-name";
import { saveAccountName } from "./lib/account-store";
import { saveAddedAi } from "./lib/connections";
import { runOAuthLogin } from "./lib/oauth-login";
import { credentialPath, oauthProvider, type OAuthProviderId } from "./lib/oauth-providers";
import { oauthClient } from "./oauth-clients";

export function ProviderLogin(props: { provider: OAuthProviderId; onSaved: () => void }) {
  const provider = oauthProvider(props.provider);
  const [phase, setPhase] = useState<"ready" | "waiting" | "saved" | "failed">("ready");
  const [detail, setDetail] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { pop } = useNavigation();

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function signIn() {
    const home = homedir();
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setPhase("waiting");
    setDetail(`Opening ${provider.title} in the browser. Leave this screen open until the credential is saved.`);
    try {
      const result = await runOAuthLogin({
        provider: props.provider,
        home,
        signal: controller.signal,
        openUrl: open,
      });
      if (controller.signal.aborted) return;
      await oauthClient(props.provider).setTokens({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        idToken: result.idToken,
        expiresIn: result.expiresIn,
        scope: result.scope,
      });
      const accountName = detectedAccountName(home);
      await saveAccountName(accountName);
      await saveAddedAi({ provider: props.provider, accountName, signedInAt: Date.now() });
      props.onSaved();
      setSavedPath(result.credentialPath);
      setPhase("saved");
      await showToast({
        style: Toast.Style.Success,
        title: "Credential Saved",
        message: `${provider.title} OAuth is stored for this Mac.`,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setDetail(caught instanceof Error ? caught.message : "OAuth sign-in failed.");
      setPhase("failed");
    }
  }

  if (phase !== "ready") {
    const markdown =
      phase === "saved"
        ? `## Credential saved\n\n${provider.title} OAuth is stored at \`${savedPath}\`.\n\nRaycast settings shows this account and can log it out. Ask uses the saved credential.`
        : phase === "failed"
          ? `## OAuth sign-in stopped\n\n${detail}`
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
              <Action title="Try OAuth Again" icon={Icon.ArrowClockwise} onAction={() => void signIn()} />
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
          <Action title="Sign In with OAuth" icon={Icon.Globe} onAction={() => void signIn()} />
        </ActionPanel>
      }
    >
      <Form.Description
        title={provider.title}
        text="Raycast settings cannot open this login. This screen starts the provider's OAuth page in your browser and keeps the credential when the browser returns."
      />
      <Form.Description title="Credential" text={`Saved at ${credentialPath(props.provider, homedir())}.`} />
    </Form>
  );
}
