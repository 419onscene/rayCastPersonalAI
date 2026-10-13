import { Action, ActionPanel, Alert, confirmAlert, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { homedir } from "os";
import { useCallback, useEffect, useState } from "react";
import { loadAddedAis, removeAddedAi } from "./lib/connections";
import { type AddedAi } from "./lib/connection-json";
import { removeCredential } from "./lib/oauth-login";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "./lib/oauth-providers";
import { oauthClient } from "./oauth-clients";
import { ProviderLogin } from "./provider-login";

export default function Command() {
  const [connections, setConnections] = useState<AddedAi[] | undefined>(undefined);
  const [error, setError] = useState<string>();
  const { push } = useNavigation();

  const reload = useCallback(() => {
    loadAddedAis()
      .then((loaded) => {
        setConnections(loaded);
        setError(undefined);
      })
      .catch((caught: unknown) => {
        setConnections([]);
        setError(caught instanceof Error ? caught.message : "Couldn't load saved sign-ins.");
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function remove(provider: OAuthProviderId, title: string) {
    const confirmed = await confirmAlert({
      title: "Remove Saved Sign-In",
      message: `Remove the saved ${title} OAuth credential from this Mac?`,
      primaryAction: { title: "Remove Sign-In", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await removeAddedAi(provider);
      removeCredential(provider, homedir());
      await oauthClient(provider).removeTokens();
      reload();
      await showToast({ style: Toast.Style.Success, title: "Saved Sign-In Removed" });
    } catch (caught) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't Remove Sign-In",
        message: caught instanceof Error ? caught.message : "Local storage rejected the delete.",
      });
    }
  }

  return (
    <List
      isLoading={connections === undefined}
      navigationTitle="Add AI"
      searchBarPlaceholder="Choose Claude, ChatGPT, or Grok"
    >
      {error ? (
        <List.EmptyView title="Couldn't Load Sign-Ins" description={error} />
      ) : connections === undefined ? null : (
        OAUTH_PROVIDERS.map((provider) => {
          const added = connections?.find((item) => item.provider === provider.id);
          return (
            <List.Item
              key={provider.id}
              icon={added ? Icon.CheckCircle : Icon.Plus}
              title={provider.title}
              subtitle={added ? "OAuth credential saved" : "Not signed in"}
              accessories={[{ text: added ? "Credential saved" : "OAuth" }]}
              actions={
                <ActionPanel>
                  <Action
                    title={added ? `Sign In to ${provider.title} Again` : `Sign In to ${provider.title}`}
                    icon={Icon.Globe}
                    onAction={() => push(<ProviderLogin provider={provider.id} onSaved={reload} />)}
                  />
                  {added ? (
                    <Action
                      title="Remove Saved Sign-In"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => void remove(provider.id, provider.title)}
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
