import { Action, ActionPanel, Form, showToast, Toast, useNavigation } from "@raycast/api";
import { createPrompt, updatePrompt } from "./lib/prompts";
import { type SavedPrompt } from "./lib/types";

export function PromptEditor(props: { prompt?: SavedPrompt; onSaved: () => void }) {
  const { pop } = useNavigation();
  const editing = Boolean(props.prompt);

  async function handleSubmit(values: { name?: string; body?: string }) {
    const name = values.name?.trim() ?? "";
    const body = values.body?.trim() ?? "";
    if (!name || !body) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Name and Prompt Needed",
        message: "Give the template a name and the text to reuse.",
      });
      return;
    }
    try {
      if (props.prompt) await updatePrompt(props.prompt.id, name, body);
      else await createPrompt(name, body);
      props.onSaved();
      await showToast({ style: Toast.Style.Success, title: editing ? "Saved Prompt Updated" : "Saved Prompt Created" });
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Couldn't Save Prompt",
        message: error instanceof Error ? error.message : "Local storage rejected the prompt.",
      });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title={editing ? "Save Prompt" : "Create Prompt"} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="Weekly status" defaultValue={props.prompt?.name} autoFocus />
      <Form.TextArea
        id="body"
        title="Template"
        placeholder="Summarize this as a status update:"
        defaultValue={props.prompt?.body}
        enableMarkdown
        info="When you ask, text you type in the Ask window is appended after this template."
      />
    </Form>
  );
}
