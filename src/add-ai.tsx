import { Action, ActionPanel, Alert, confirmAlert, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { homedir } from "os";
import { useCallback, useEffect, useState } from "react";
import { commandEnv, resolveCliBinary } from "./lib/binaries";
import { cliPathFor, readPreferences } from "./lib/preferences";
import { runCommand } from "./lib/process";
import {
  forgetGrant,
  readProviders,
  SUBSCRIPTIONS,
  subscription,
  type SubscriptionProviderId,
} from "./lib/subscription-login";
import { oauthClient, showSubscriptionAccount } from "./oauth-clients";
import { ProviderLogin } from "./provider-login";

export default function Command() {
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const { push } = useNavigation();
  const preferences = readPreferences();

  const reload = useCallback(() => {
    try {
      const home = homedir();
      const grants = readProviders(home);
      const next: Record<string, boolean> = {};
      for (const provider of SUBSCRIPTIONS) {
        next[provider.id] = grants[provider.grantKey]?.authorized === true;
        if (next[provider.id]) void showSubscriptionAccount(provider.id).catch(() => undefined);
      }
      setAuthorized(next);
      setError(undefined);
    } catch (caught) {
      setAuthorized({});
      setError(caught instanceof Error ? caught.message : "Couldn't load saved sign-ins.");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function logOut(provider: SubscriptionProviderId, title: string) {
    const confirmed = await confirmAlert({
      title: `Log Out of ${title}`,
      message: `Sign out of the ${title} subscription and drop the saved grant?`,
      primaryAction: { title: "Log Out", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    const spec = subscription(provider);
    const preferencePath = cliPathFor(preferences, spec.command);
    const resolved = resolveCliBinary({ command: spec.command, preferencePath, home: homedir() });
    try {
      if ("path" in resolved) {
        await runCommand(resolved.path, spec.logoutArgs, {
          env: commandEnv(resolved.path, undefined, homedir()),
        });
      }
      forgetGrant(provider, homedir());
      await oauthClient(provider).removeTokens();
      reload();
      await showToast({ style: Toast.Style.Success, title: `${title} Logged Out` });
    } catch (caught) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't Log Out",
        message: caught instanceof Error ? caught.message : "The subscription CLI rejected log out.",
      });
    }
  }

  return (
    <List isLoading={!ready} navigationTitle="Add AI" searchBarPlaceholder="Choose Claude, ChatGPT, or Grok">
      {error ? (
        <List.EmptyView title="Couldn't Load Sign-Ins" description={error} />
      ) : !ready ? null : (
        SUBSCRIPTIONS.map((provider) => {
          const signedIn = authorized[provider.id] === true;
          return (
            <List.Item
              key={provider.id}
              icon={signedIn ? Icon.CheckCircle : Icon.Plus}
              title={provider.title}
              subtitle={signedIn ? `Authorized with the ${provider.title} subscription.` : "Not signed in"}
              accessories={[{ text: signedIn ? "Grant saved" : "Sign in" }]}
              actions={
                <ActionPanel>
                  <Action
                    title={signedIn ? "Sign in Again" : "Sign in"}
                    icon={Icon.Terminal}
                    onAction={() => push(<ProviderLogin provider={provider.id} onSaved={reload} />)}
                  />
                  {signedIn ? (
                    <Action
                      title="Log out"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => void logOut(provider.id, provider.title)}
                    />
                  ) : null}
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}
