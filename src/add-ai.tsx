import { Action, ActionPanel, Alert, confirmAlert, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { loadAddedAis, removeAddedAi } from "./lib/connections";
import { type AddedAi } from "./lib/connection-json";
import { PROVIDER_LABEL, PROVIDERS, type ProviderId } from "./lib/types";
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

  async function remove(provider: ProviderId) {
    const confirmed = await confirmAlert({
      title: "Remove Saved Sign-In",
      message: `Remove the saved ${PROVIDER_LABEL[provider]} sign-in from Personal AI?`,
      primaryAction: { title: "Remove Sign-In", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await removeAddedAi(provider);
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
    <List isLoading={connections === undefined} searchBarPlaceholder="Search AI providers">
      {error ? (
        <List.EmptyView title="Couldn't Load Sign-Ins" description={error} />
      ) : connections === undefined ? null : (
        PROVIDERS.map((provider) => {
          const added = connections?.find((item) => item.provider === provider.id);
          return (
            <List.Item
              key={provider.id}
              icon={added ? Icon.CheckCircle : Icon.Plus}
              title={provider.title}
              subtitle={added ? `Signed in as ${added.accountName}` : "Not signed in"}
              accessories={[{ text: added ? "Credential saved" : "Add" }]}
              actions={
                <ActionPanel>
                  <Action
                    title={added ? `Sign In to ${provider.title} Again` : `Add ${provider.title}`}
                    icon={added ? Icon.ArrowClockwise : Icon.Plus}
                    onAction={() =>
                      push(
                        <ProviderLogin
                          provider={provider.id}
                          initialAccountName={added?.accountName}
                          onSaved={reload}
                        />,
                      )
                    }
                  />
                  {added ? (
                    <Action
                      title="Remove Saved Sign-In"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={() => void remove(provider.id)}
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
