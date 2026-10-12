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
import { resolveCliBinary } from "./lib/binaries";
import { composePrompt } from "./lib/compose-prompt";
import { buildModelChoices, selectModel } from "./lib/models";
import { listOllamaModels, readOllamaThinking, type OllamaThinking } from "./lib/ollama";
import { cliPathFor, readPreferences } from "./lib/preferences";
import { loadPrompts } from "./lib/prompts";
import { selectThinking, thinkingCatalog } from "./lib/thinking";
import { CLI_COMMAND, isProviderId, PROVIDERS, type ProviderId, type SavedPrompt } from "./lib/types";

const MISSING_MODEL = "__missing__";

export function AskCommand(props: { provider?: ProviderId }) {
  const preferences = readPreferences();
  const locked = props.provider;
  const initialProvider = locked ?? preferences.defaultProvider;
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [thinking, setThinking] = useState(preferences.defaultThinking);
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
  const [ollamaThinking, setOllamaThinking] = useState<OllamaThinking>();
  const [thinkingLoading, setThinkingLoading] = useState(false);
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
    const resolved = resolveCliBinary({ command: "ollama", preferencePath: preferences.ollamaCliPath });
    if ("error" in resolved) {
      setOllamaModels([]);
      setOllamaMessage(resolved.error);
      setOllamaLoading(false);
      return;
    }
    const controller = new AbortController();
    setOllamaLoading(true);
    setOllamaMessage(undefined);
    listOllamaModels(resolved.path, preferences.ollamaHost, controller.signal)
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
        setOllamaMessage(error instanceof Error ? error.message : "Couldn't list Ollama models.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setOllamaLoading(false);
      });
    return () => controller.abort();
  }, [
    provider,
    preferences.ollamaCliPath,
    preferences.ollamaHost,
    preferences.customModelId,
    preferences.defaultModel,
    preferences.defaultProvider,
  ]);

  useEffect(() => {
    if (provider !== "ollama" || !model || model === MISSING_MODEL) {
      setOllamaThinking(undefined);
      setThinkingLoading(false);
      return;
    }
    const resolved = resolveCliBinary({ command: "ollama", preferencePath: preferences.ollamaCliPath });
    if ("error" in resolved) {
      setOllamaThinking({ values: [], reported: false });
      setThinkingLoading(false);
      return;
    }
    const controller = new AbortController();
    setThinkingLoading(true);
    readOllamaThinking(resolved.path, model, preferences.ollamaHost, controller.signal)
      .then((report) => setOllamaThinking(report))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOllamaThinking({ values: [], reported: false });
        setOllamaMessage(error instanceof Error ? error.message : "Couldn't read this model's thinking levels.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setThinkingLoading(false);
      });
    return () => controller.abort();
  }, [provider, model, preferences.ollamaCliPath, preferences.ollamaHost]);

  const modelInput = {
    provider,
    defaultProvider: preferences.defaultProvider,
    installedOllamaModels: ollamaModels,
    defaultModel: preferences.defaultModel,
    customModelId: preferences.customModelId,
  };
  const choices = buildModelChoices(modelInput);
  const modelValue = choices.some((choice) => choice.id === model) ? model : (choices[0]?.id ?? MISSING_MODEL);
  const catalog =
    provider === "ollama" && (thinkingLoading || !ollamaThinking)
      ? { levels: [], note: "Checking this model's thinking levels…" }
      : thinkingCatalog(
          provider,
          provider === "apple" ? "" : modelValue,
          provider === "ollama" ? ollamaThinking : undefined,
        );
  const thinkingValue = selectThinking(catalog, preferences.defaultThinking, thinking);

  useEffect(() => {
    if (thinkingValue !== thinking) setThinking(thinkingValue);
  }, [thinkingValue, thinking]);

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
        thinking={thinkingValue}
        thinkingLabel={catalog.levels.find((level) => level.id === thinkingValue)?.title ?? "CLI default"}
        note={catalog.note}
        prompt={prompt}
        appleShortcutName={preferences.appleShortcutName}
        ollamaHost={preferences.ollamaHost}
        ollamaLevels={provider === "ollama" ? (ollamaThinking?.values ?? []) : []}
        claudeCliPath={preferences.claudeCliPath}
        codexCliPath={preferences.codexCliPath}
        grokCliPath={preferences.grokCliPath}
        ollamaCliPath={preferences.ollamaCliPath}
        shortcutsCliPath={preferences.shortcutsCliPath}
      />,
    );
  }

  const cliHint = `\`${CLI_COMMAND[provider]}\` · ${cliPathFor(preferences, CLI_COMMAND[provider]) || "common install locations"}`;

  return (
    <Form
      isLoading={prompts === undefined || ollamaLoading || thinkingLoading}
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
        text="Pick a saved prompt to start from it. Anything you type here is added after that template. The reply comes from the local CLI you already signed in to."
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
            setOllamaThinking(undefined);
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
          text={`Runs the “${preferences.appleShortcutName}” shortcut with the shortcuts command.`}
        />
      ) : (
        <Form.Dropdown
          id="model"
          title="Model"
          value={modelValue}
          onChange={(value) => {
            setModel(value);
            setOllamaThinking(undefined);
          }}
        >
          {choices.length > 0 ? (
            choices.map((choice) => <Form.Dropdown.Item key={choice.id} value={choice.id} title={choice.title} />)
          ) : (
            <Form.Dropdown.Item value={MISSING_MODEL} title="No Model Available" />
          )}
        </Form.Dropdown>
      )}
      {provider === "ollama" && ollamaMessage ? <Form.Description title="Ollama" text={ollamaMessage} /> : null}
      {catalog.levels.length > 0 ? (
        <Form.Dropdown id="thinking" title="Thinking" value={thinkingValue} info={cliHint} onChange={setThinking}>
          {catalog.levels.map((level) => (
            <Form.Dropdown.Item key={level.id} value={level.id} title={level.title} />
          ))}
        </Form.Dropdown>
      ) : (
        <Form.Description title="Thinking" text={catalog.note ?? "This model has no thinking levels."} />
      )}
      <Form.Description title="Command" text={cliHint} />
    </Form>
  );
}
