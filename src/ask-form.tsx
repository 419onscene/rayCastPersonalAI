import {
  Action,
  ActionPanel,
  Form,
  Icon,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { Answer } from "./answer";
import { composePrompt } from "./lib/compose-prompt";
import { buildModelChoices, selectModel } from "./lib/models";
import { listOllamaModels } from "./lib/ollama";
import { apiKeyFor, readPreferences } from "./lib/preferences";
import { loadPrompts } from "./lib/prompts";
import {
  isProviderId,
  isThinkingLevel,
  PROVIDERS,
  THINKING_LEVELS,
  type ProviderId,
  type SavedPrompt,
  type ThinkingLevel,
} from "./lib/types";

const MISSING_MODEL = "__missing__";

export function AskCommand(props: { provider?: ProviderId }) {
  const preferences = readPreferences();
  const locked = props.provider;
  const initialProvider = locked ?? preferences.defaultProvider;
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [thinking, setThinking] = useState<ThinkingLevel>(preferences.defaultThinking);
  const [model, setModel] = useState(() =>
    selectModel({
      provider: initialProvider,
      defaultProvider: preferences.defaultProvider,
      installedOllamaModels: [],
      defaultModel: preferences.defaultModel,
      customModelId: preferences.customModelId,
    }),
  );
  const [prompts, setPrompts] = useState<SavedPrompt[] | undefined>(undefined);
  const [promptError, setPromptError] = useState<string>();
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaMessage, setOllamaMessage] = useState<string>();
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const { push } = useNavigation();

  useEffect(() => {
    let cancelled = false;
    loadPrompts()
      .then((loaded) => {
        if (!cancelled) setPrompts(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPrompts([]);
        setPromptError(error instanceof Error ? error.message : "Couldn't load saved prompts.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (provider !== "ollama") return;
    const controller = new AbortController();
    setOllamaLoading(true);
    setOllamaMessage(undefined);
    listOllamaModels(preferences.ollamaBaseUrl, controller.signal)
      .then((models) => {
        setOllamaModels(models);
        setModel((current) =>
          selectModel(
            {
              provider: "ollama",
              defaultProvider: preferences.defaultProvider,
              installedOllamaModels: models,
              defaultModel: preferences.defaultModel,
              customModelId: preferences.customModelId,
            },
            current,
          ),
        );
        if (models.length === 0) {
          setOllamaMessage(
            preferences.customModelId
              ? "Ollama has no installed models. The custom model id is still available."
              : "Ollama is running, but no models are installed. Pull one, or set a custom model id.",
          );
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOllamaModels([]);
        setOllamaMessage(error instanceof Error ? error.message : "Couldn't reach Ollama.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setOllamaLoading(false);
      });
    return () => controller.abort();
  }, [
    provider,
    preferences.ollamaBaseUrl,
    preferences.customModelId,
    preferences.defaultModel,
    preferences.defaultProvider,
  ]);

  const modelInput = {
    provider,
    defaultProvider: preferences.defaultProvider,
    installedOllamaModels: ollamaModels,
    defaultModel: preferences.defaultModel,
    customModelId: preferences.customModelId,
  };
  const choices = buildModelChoices(modelInput);
  const modelValue = choices.some((choice) => choice.id === model) ? model : (choices[0]?.id ?? MISSING_MODEL);

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
    if (provider !== "apple" && (!modelValue || modelValue === MISSING_MODEL)) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Model Needed",
        message: ollamaMessage ?? "Pick a model.",
      });
      return;
    }

    push(
      <Answer
        provider={provider}
        model={provider === "apple" ? "" : modelValue}
        thinking={thinking}
        prompt={prompt}
        apiKey={apiKeyFor(preferences, provider)}
        ollamaBaseUrl={preferences.ollamaBaseUrl}
        appleShortcutName={preferences.appleShortcutName}
      />,
    );
  }

  return (
    <Form
      isLoading={prompts === undefined || ollamaLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Ask" onSubmit={handleSubmit} icon={Icon.SpeechBubble} />
          <Action
            title="Open Extension Preferences"
            icon={Icon.Gear}
            onAction={() => void openExtensionPreferences()}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="How Asking Works"
        text="Pick a saved prompt to start from it. Anything you type here is added after that template."
      />
      <Form.TextArea id="prompt" title="Prompt" placeholder="What do you want to know?" autoFocus enableMarkdown />
      <Form.Dropdown id="templateId" title="Saved Prompt" defaultValue="none">
        <Form.Dropdown.Item value="none" title="None" />
        {(prompts ?? []).map((prompt) => (
          <Form.Dropdown.Item key={prompt.id} value={prompt.id} title={prompt.name} />
        ))}
      </Form.Dropdown>
      {promptError ? <Form.Description title="Saved Prompts" text={promptError} /> : null}
      {locked ? (
        <Form.Description title="Provider" text={PROVIDERS.find((item) => item.id === locked)?.title ?? locked} />
      ) : (
        <Form.Dropdown
          id="provider"
          title="Provider"
          value={provider}
          onChange={(value) => {
            if (!isProviderId(value)) return;
            setProvider(value);
            setModel(
              selectModel({
                ...modelInput,
                provider: value,
              }),
            );
          }}
        >
          {PROVIDERS.map((item) => (
            <Form.Dropdown.Item key={item.id} value={item.id} title={item.title} />
          ))}
        </Form.Dropdown>
      )}
      {provider === "apple" ? (
        <Form.Description
          title="Model"
          text={`Runs the “${preferences.appleShortcutName}” shortcut. Apple Intelligence has no third-party model API.`}
        />
      ) : (
        <Form.Dropdown id="model" title="Model" value={modelValue} onChange={setModel}>
          {choices.length > 0 ? (
            choices.map((choice) => <Form.Dropdown.Item key={choice.id} value={choice.id} title={choice.title} />)
          ) : (
            <Form.Dropdown.Item value={MISSING_MODEL} title="No Model Available" />
          )}
        </Form.Dropdown>
      )}
      {provider === "ollama" && ollamaMessage ? <Form.Description title="Ollama" text={ollamaMessage} /> : null}
      <Form.Dropdown
        id="thinking"
        title="Thinking"
        value={thinking}
        info="Claude uses effort and thinking. ChatGPT uses reasoning_effort. Grok uses reasoning effort. Ollama uses think."
        onChange={(value) => {
          if (isThinkingLevel(value)) setThinking(value);
        }}
      >
        {THINKING_LEVELS.map((level) => (
          <Form.Dropdown.Item key={level.id} value={level.id} title={level.title} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
