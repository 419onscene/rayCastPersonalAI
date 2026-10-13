import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { homedir } from "os";
import { useEffect, useMemo, useState } from "react";
import { Answer } from "./answer";
import { askableProviders, initialProvider, PROMPT_HELP } from "./lib/ask-providers";
import { resolveCliBinary } from "./lib/binaries";
import { composePrompt } from "./lib/compose-prompt";
import { listAccountModels, selectAccountModel, type AccountModel } from "./lib/models";
import { readOllamaThinking, type OllamaThinking } from "./lib/ollama";
import { readPreferences } from "./lib/preferences";
import { loadPrompts } from "./lib/prompts";
import { selectThinking, thinkingCatalog, type ThinkingCatalog } from "./lib/thinking";
import { isSubscriptionProvider, subscriptionAuthorized } from "./lib/subscription-login";
import { isProviderId, PROVIDER_LABEL, type ProviderId, type SavedPrompt } from "./lib/types";

export function AskCommand(props: { provider?: ProviderId }) {
  const preferences = readPreferences();
  const {
    defaultModel,
    defaultThinking,
    defaultProvider,
    ollamaHost,
    appleShortcutName,
    claudeCliPath,
    codexCliPath,
    grokCliPath,
    ollamaCliPath,
    shortcutsCliPath,
  } = preferences;
  const home = homedir();
  const available = useMemo(
    () =>
      askableProviders({
        claude: readGrant("anthropic", home),
        chatgpt: readGrant("openai", home),
        grok: readGrant("xai", home),
        includeLocal: props.provider,
      }),
    [home, props.provider],
  );
  const [provider, setProvider] = useState<ProviderId>(() =>
    initialProvider(available, props.provider, defaultProvider),
  );
  const [thinking, setThinking] = useState(defaultThinking);
  const [model, setModel] = useState(props.provider === "anthropic" ? defaultModel : "");
  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState("none");
  const [prompts, setPrompts] = useState<SavedPrompt[] | undefined>(undefined);
  const [promptError, setPromptError] = useState<string>();
  const [models, setModels] = useState<AccountModel[]>([]);
  const [listError, setListError] = useState<string>();
  const [listLoading, setListLoading] = useState(provider !== "apple" && provider !== "anthropic");
  const [ollamaThinking, setOllamaThinking] = useState<OllamaThinking>();
  const [thinkingLoading, setThinkingLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const { push } = useNavigation();
  const signedIn = !isSubscriptionProvider(provider) || available.includes(provider);

  useEffect(() => {
    if (available.length > 0 && !available.includes(provider)) setProvider(available[0]);
  }, [available, provider]);

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
    if (available.length === 0) {
      setListLoading(false);
      return;
    }
    if (provider === "apple") {
      setModels([]);
      setListError(undefined);
      setListLoading(false);
      setStatusMessage(undefined);
      return;
    }
    if (isSubscriptionProvider(provider) && !signedIn) {
      setModels([]);
      setListError(undefined);
      setListLoading(false);
      setStatusMessage(undefined);
      return;
    }
    if (provider === "anthropic") {
      setModels([]);
      setListError(undefined);
      setListLoading(false);
      setStatusMessage(undefined);
      return;
    }
    const controller = new AbortController();
    setListLoading(true);
    setListError(undefined);
    setModels([]);
    setStatusMessage(undefined);
    const preferencePath =
      provider === "openai"
        ? codexCliPath
        : provider === "xai"
          ? grokCliPath
          : provider === "ollama"
            ? ollamaCliPath
            : claudeCliPath;
    listAccountModels({
      provider,
      preferencePath,
      ollamaHost,
      home,
      signal: controller.signal,
    })
      .then((result) => {
        setModels(result.models);
        setListError(result.error);
        setModel((current) => selectAccountModel(result.models, defaultModel, current));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setModels([]);
        setListError(error instanceof Error ? error.message : "Couldn't list models for this account.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [
    provider,
    defaultModel,
    ollamaHost,
    claudeCliPath,
    codexCliPath,
    grokCliPath,
    ollamaCliPath,
    home,
    signedIn,
    available.length,
  ]);

  useEffect(() => {
    if (provider !== "ollama" || !model) {
      setOllamaThinking(undefined);
      setThinkingLoading(false);
      return;
    }
    const resolved = resolveCliBinary({ command: "ollama", preferencePath: ollamaCliPath, home });
    if ("error" in resolved) {
      setOllamaThinking({ values: [], reported: false });
      setThinkingLoading(false);
      return;
    }
    const controller = new AbortController();
    setThinkingLoading(true);
    setStatusMessage(undefined);
    readOllamaThinking(resolved.path, model, ollamaHost, controller.signal, home)
      .then((report) => setOllamaThinking(report))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOllamaThinking({ values: [], reported: false });
        setStatusMessage(error instanceof Error ? error.message : "Couldn't read this model's thinking levels.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setThinkingLoading(false);
      });
    return () => controller.abort();
  }, [provider, model, ollamaCliPath, ollamaHost, home]);

  const modelValue =
    provider === "anthropic" ? model.trim() : models.some((item) => item.id === model) ? model : (models[0]?.id ?? "");
  const selected = models.find((item) => item.id === modelValue);
  const reported = provider === "ollama" ? ollamaThinking : selected?.efforts;
  const catalog = resolveCatalog({
    provider,
    model: modelValue,
    listLoading,
    listError,
    thinkingLoading,
    reported,
  });
  const thinkingValue = selectThinking(catalog, defaultThinking, thinking);

  useEffect(() => {
    if (models.length === 0 || modelValue === model) return;
    setModel(modelValue);
  }, [models.length, modelValue, model]);

  useEffect(() => {
    if (thinkingValue !== thinking) setThinking(thinkingValue);
  }, [thinkingValue, thinking]);

  async function submit() {
    const template = prompts?.find((item) => item.id === templateId);
    if (templateId !== "none" && !template) {
      await showToast({ style: Toast.Style.Failure, title: "Saved Prompt Missing", message: "Pick another template." });
      return;
    }
    const composed = composePrompt(template?.body, prompt);
    if (!composed) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Prompt Needed",
        message: "Type a prompt or pick a saved prompt.",
      });
      return;
    }
    if (available.length === 0 || listLoading || (provider === "ollama" && thinkingLoading && !listError)) {
      await showToast({
        style: Toast.Style.Animated,
        title: "Still Checking Models",
        message: "Wait until the account's model list finishes.",
      });
      return;
    }
    if (!listError && provider !== "apple" && provider !== "anthropic" && !modelValue) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Model Needed",
        message: "The account list did not include a model.",
      });
      return;
    }

    const levels = catalog.levels.map((level) => level.id);
    push(
      <Answer
        provider={provider}
        model={provider === "apple" ? "" : modelValue}
        thinking={thinkingValue}
        thinkingLabel={catalog.levels.find((level) => level.id === thinkingValue)?.title ?? "CLI default"}
        note={listError ? undefined : catalog.note}
        prompt={composed}
        appleShortcutName={appleShortcutName}
        ollamaHost={ollamaHost}
        thinkingLevels={levels}
        listError={listError}
        claudeCliPath={claudeCliPath}
        codexCliPath={codexCliPath}
        grokCliPath={grokCliPath}
        ollamaCliPath={ollamaCliPath}
        shortcutsCliPath={shortcutsCliPath}
        home={home}
      />,
    );
  }

  function chooseProvider(value: string) {
    if (!isProviderId(value) || value === provider || !available.includes(value)) return;
    setProvider(value);
    setModel(value === "anthropic" ? defaultModel : "");
    setModels([]);
    setListError(undefined);
    setOllamaThinking(undefined);
  }

  const modelChip =
    provider === "apple"
      ? appleShortcutName
      : provider === "anthropic"
        ? model.trim() || "Current model"
        : listLoading
          ? "Checking…"
          : (selected?.title ?? (listError ? "No model" : "No model"));
  const thinkingChip =
    catalog.levels.length > 0
      ? (catalog.levels.find((level) => level.id === thinkingValue)?.title ?? thinkingValue)
      : "None";
  const thinkingTooltip = catalog.levels.length > 0 ? "Thinking" : (statusMessage ?? catalog.note ?? "Thinking");
  const savedTitle = prompts?.find((item) => item.id === templateId)?.name ?? "None";

  if (available.length === 0) {
    return (
      <List>
        <List.EmptyView
          title="No Signed-in AI"
          description="Open Add AI and finish the Terminal sign-in for Claude, ChatGPT, or Grok."
          actions={
            <ActionPanel>
              <Action
                title="Open Extension Preferences"
                icon={Icon.Gear}
                onAction={() => void openExtensionPreferences()}
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  const actions = (
    <ActionPanel>
      <Action title="Ask" icon={Icon.SpeechBubble} onAction={() => void submit()} />
      <ActionPanel.Section title="Model">
        {provider === "anthropic" ? (
          <Action
            title="Set Model"
            icon={Icon.Pencil}
            onAction={() => push(<ClaudeModelEditor value={model} onSave={setModel} />)}
          />
        ) : (
          models.map((choice) => (
            <Action
              key={choice.id}
              title={choice.title}
              icon={choice.id === modelValue ? Icon.Check : Icon.Circle}
              onAction={() => setModel(choice.id)}
            />
          ))
        )}
      </ActionPanel.Section>
      {catalog.levels.length > 0 ? (
        <ActionPanel.Section title="Thinking">
          {catalog.levels.map((level) => (
            <Action
              key={level.id}
              title={level.title}
              icon={level.id === thinkingValue ? Icon.Check : Icon.Circle}
              onAction={() => setThinking(level.id)}
            />
          ))}
        </ActionPanel.Section>
      ) : null}
      <ActionPanel.Section title="Saved Prompt">
        <Action
          title="None"
          icon={templateId === "none" ? Icon.Check : Icon.Circle}
          onAction={() => setTemplateId("none")}
        />
        {(prompts ?? []).map((item) => (
          <Action
            key={item.id}
            title={item.name}
            icon={item.id === templateId ? Icon.Check : Icon.Circle}
            onAction={() => setTemplateId(item.id)}
          />
        ))}
      </ActionPanel.Section>
      <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={() => void openExtensionPreferences()} />
    </ActionPanel>
  );

  return (
    <List
      isLoading={prompts === undefined || listLoading || thinkingLoading}
      searchText={prompt}
      onSearchTextChange={setPrompt}
      searchBarPlaceholder="What do you want to know?"
      filtering={false}
      navigationTitle="Ask"
      searchBarAccessory={
        <List.Dropdown tooltip="Signed-in AI" value={provider} onChange={chooseProvider}>
          {available.map((id) => (
            <List.Dropdown.Item key={id} value={id} title={PROVIDER_LABEL[id]} />
          ))}
        </List.Dropdown>
      }
    >
      <List.Item
        id="prompt"
        title={{ value: "Prompt", tooltip: PROMPT_HELP }}
        accessories={[
          { tag: modelChip, tooltip: listError ?? "Model. Open Actions to change it." },
          {
            tag: thinkingChip,
            tooltip: catalog.levels.length > 0 ? "Thinking. Open Actions to change it." : thinkingTooltip,
          },
        ]}
        actions={actions}
      />
      <List.Item id="saved-prompt" title="Saved Prompt" subtitle={promptError ?? savedTitle} actions={actions} />
    </List>
  );
}

function ClaudeModelEditor(props: { value: string; onSave: (value: string) => void }) {
  const { pop } = useNavigation();
  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Use Model"
            onSubmit={(values: { model?: string }) => {
              props.onSave(values.model ?? "");
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="model"
        title="Model"
        defaultValue={props.value}
        placeholder="Leave blank for Claude's current model"
        info="Claude Code cannot list the models for this login. Leave this blank to use the model already selected in Claude Code, or type an id from /model."
      />
    </Form>
  );
}

function resolveCatalog(input: {
  provider: ProviderId;
  model: string;
  listLoading: boolean;
  listError?: string;
  thinkingLoading: boolean;
  reported?: { values: string[]; defaultValue?: string; reported: boolean };
}): ThinkingCatalog {
  if (input.provider === "apple") return thinkingCatalog("apple", "");
  if (input.provider === "anthropic") {
    if (!input.model) {
      return {
        levels: [],
        note: "This run uses the model already selected in Claude Code, and it does not pass --effort.",
      };
    }
    return thinkingCatalog("anthropic", input.model);
  }
  if (input.listLoading) return { levels: [], note: "Checking which models this account can use…" };
  if (input.listError || !input.model) {
    return { levels: [], note: "Thinking stays hidden until a model from this account is selected." };
  }
  if (input.provider === "ollama" && (input.thinkingLoading || !input.reported)) {
    return { levels: [], note: "Checking this model's thinking levels…" };
  }
  return thinkingCatalog(input.provider, input.model, input.reported?.reported ? input.reported : undefined);
}

function readGrant(provider: "anthropic" | "openai" | "xai", home: string): boolean {
  try {
    return subscriptionAuthorized(provider, home);
  } catch {
    return false;
  }
}
