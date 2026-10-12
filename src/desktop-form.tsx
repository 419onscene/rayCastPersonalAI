import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useEffect, useState } from "react";
import { composePrompt } from "./lib/compose-prompt";
import { openChatGptDesktop, openClaudeDesktop } from "./lib/desktop";
import { loadPrompts } from "./lib/prompts";
import { type SavedPrompt } from "./lib/types";

export function DesktopCommand(props: { app: "claude" | "chatgpt" }) {
  const appName = props.app === "claude" ? "Claude" : "ChatGPT";
  const [prompts, setPrompts] = useState<SavedPrompt[] | undefined>(undefined);
  const { pop } = useNavigation();

  useEffect(() => {
    let cancelled = false;
    loadPrompts()
      .then((loaded) => {
        if (!cancelled) setPrompts(loaded);
      })
      .catch(() => {
        if (!cancelled) setPrompts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(values: { prompt?: string; templateId?: string }) {
    const templateId = values.templateId ?? "none";
    const template = prompts?.find((item) => item.id === templateId);
    if (templateId !== "none" && !template) {
      await showToast({ style: Toast.Style.Failure, title: "Saved Prompt Missing", message: "Pick another template." });
      return;
    }
    const prompt = composePrompt(template?.body, values.prompt ?? "");
    if (!prompt) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Prompt Needed",
        message: "Type a prompt or pick a saved prompt.",
      });
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: `Opening ${appName}` });
    try {
      if (props.app === "claude") {
        const result = await openClaudeDesktop(prompt);
        toast.style = Toast.Style.Success;
        toast.title = "Opened Claude";
        toast.message = result.truncated
          ? "The prompt was filled in and cut at 14,000 characters. Review it, then send."
          : "The prompt is filled in. Review it, then send.";
      } else {
        const result = await openChatGptDesktop(prompt);
        toast.style = result.warning ? Toast.Style.Failure : Toast.Style.Success;
        toast.title = result.warning ? "ChatGPT Needs a Paste" : "Opened ChatGPT";
        toast.message =
          result.warning ?? "A new chat is open with the prompt pasted. It was not sent. Review it, then press Return.";
      }
      pop();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = `${appName} Didn't Open`;
      toast.message = error instanceof Error ? error.message : `Couldn't open ${appName}.`;
    }
  }

  return (
    <Form
      isLoading={prompts === undefined}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={`Open in ${appName}`} onSubmit={handleSubmit} icon={Icon.AppWindow} />
        </ActionPanel>
      }
    >
      <Form.Description
        title={appName}
        text={
          props.app === "claude"
            ? "Opens the Claude desktop app and prefills a new chat. The message is not sent until you send it."
            : "Opens the ChatGPT desktop app and pastes the prompt into a new chat. The message is not sent. If macOS blocks typing, the app opens from a chatgpt:// link instead."
        }
      />
      <Form.TextArea id="prompt" title="Prompt" placeholder={`Text to open in ${appName}`} autoFocus />
      <Form.Dropdown id="templateId" title="Saved Prompt" defaultValue="none">
        <Form.Dropdown.Item value="none" title="None" />
        {(prompts ?? []).map((prompt) => (
          <Form.Dropdown.Item key={prompt.id} value={prompt.id} title={prompt.name} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
