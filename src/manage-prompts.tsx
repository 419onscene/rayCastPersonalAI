import { Action, ActionPanel, Alert, confirmAlert, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { deletePrompt, loadPrompts } from "./lib/prompts";
import { type SavedPrompt } from "./lib/types";
import { PromptEditor } from "./prompt-editor";

export default function Command() {
  const [prompts, setPrompts] = useState<SavedPrompt[] | undefined>(undefined);
  const [error, setError] = useState<string>();
  const { push } = useNavigation();

  const reload = useCallback(() => {
    loadPrompts()
      .then((loaded) => {
        setPrompts(loaded);
        setError(undefined);
      })
      .catch((caught: unknown) => {
        setPrompts([]);
        setError(caught instanceof Error ? caught.message : "Couldn't load saved prompts.");
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function remove(prompt: SavedPrompt) {
    const confirmed = await confirmAlert({
      title: "Delete Saved Prompt",
      message: `Delete “${prompt.name}”? This cannot be undone.`,
      primaryAction: { title: "Delete Prompt", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await deletePrompt(prompt.id);
      reload();
      await showToast({ style: Toast.Style.Success, title: "Saved Prompt Deleted" });
    } catch (caught) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't Delete Prompt",
        message: caught instanceof Error ? caught.message : "Local storage rejected the delete.",
      });
    }
  }

  return (
    <List
      isLoading={prompts === undefined}
      searchBarPlaceholder="Search saved prompts"
      isShowingDetail={Boolean(prompts?.length)}
    >
      {error ? (
        <List.EmptyView title="Couldn't Load Prompts" description={error} />
      ) : prompts?.length === 0 ? (
        <List.EmptyView
          title="No Saved Prompts"
          description="Create a template, then pick it in Ask. Text you type is appended to the template."
          actions={
            <ActionPanel>
              <Action title="Create Prompt" icon={Icon.Plus} onAction={() => push(<PromptEditor onSaved={reload} />)} />
            </ActionPanel>
          }
        />
      ) : (
        prompts?.map((prompt) => (
          <List.Item
            key={prompt.id}
            title={prompt.name}
            accessories={[{ date: new Date(prompt.updatedAt) }]}
            detail={<List.Item.Detail markdown={prompt.body} />}
            actions={
              <ActionPanel>
                <Action
                  title="Edit Prompt"
                  icon={Icon.Pencil}
                  onAction={() => push(<PromptEditor prompt={prompt} onSaved={reload} />)}
                />
                <Action
                  title="Create Prompt"
                  icon={Icon.Plus}
                  onAction={() => push(<PromptEditor onSaved={reload} />)}
                />
                <Action
                  title="Delete Prompt"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => void remove(prompt)}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
