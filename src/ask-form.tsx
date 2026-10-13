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
import { accountHome } from "./lib/account-name";
import { resolveCliBinary } from "./lib/binaries";
import { signInFirstMessage, type AddedAi } from "./lib/connection-json";
import { loadAddedAis } from "./lib/connections";
import { composePrompt } from "./lib/compose-prompt";
import { listAccountModels, selectAccountModel, type AccountModel } from "./lib/models";
import { readOllamaThinking, type OllamaThinking } from "./lib/ollama";
import { cliPathFor, readPreferences } from "./lib/preferences";
import { loadPrompts } from "./lib/prompts";
import { selectThinking, thinkingCatalog, type ThinkingCatalog } from "./lib/thinking";
import { CLI_COMMAND, isProviderId, PROVIDERS, type ProviderId, type SavedPrompt } from "./lib/types";

export function AskCommand(props: { provider?: ProviderId }) {
  const preferences = readPreferences();
  const {
    defaultModel,
    defaultThinking,
    ollamaHost,
    appleShortcutName,
    claudeCliPath,
    codexCliPath,
    grokCliPath,
    ollamaCliPath,
    shortcutsCliPath,
  } = preferences;
  const locked = props.provider;
  const initialProvider = locked ?? preferences.defaultProvider;
  const [provider, setProvider] = useState<ProviderId>(initialProvider);
  const [thinking, setThinking] = useState(defaultThinking);
  const [model, setModel] = useState(initialProvider === "anthropic" ? defaultModel : "");
  const [prompts, setPrompts] = useState<SavedPrompt[] | undefined>(undefined);
  const [promptError, setPromptError] = useState<string>();
  const [models, setModels] = useState<AccountModel[]>([]);
  const [listError, setListError] = useState<string>();
  const [listLoading, setListLoading] = useState(initialProvider !== "apple" && initialProvider !== "anthropic");
  const [ollamaThinking, setOllamaThinking] = useState<OllamaThinking>();
  const [thinkingLoading, setThinkingLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [connections, setConnections] = useState<AddedAi[] | undefined>();
  const { push } = useNavigation();
  const added = connections?.find((item) => item.provider === provider);
  const home = added ? accountHome(added.accountName) : undefined;
  const connectionsReady = connections !== undefined;

  useEffect(() => {
    let cancelled = false;
    loadAddedAis()
      .then((loaded) => {
        if (!cancelled) setConnections(loaded);
      })
      .catch(() => {
        if (!cancelled) setConnections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const needsOAuth = provider === "anthropic" || provider === "openai" || provider === "xai";
    if (!connectionsReady) {
      if (needsOAuth || provider === "ollama") setListLoading(true);
      return;
    }
    if (provider === "apple") {
      setModels([]);
      setListError(undefined);
      setListLoading(false);
      setStatusMessage(undefined);
      return;
    }
    if (needsOAuth && !added) {
      setModels([]);
      setListError(signInFirstMessage(provider));
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
    connectionsReady,
    added,
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
    if (!connectionsReady || listLoading || (provider === "ollama" && thinkingLoading && !listError)) {
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
        prompt={prompt}
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

  const cliHint = `\`${CLI_COMMAND[provider]}\` · ${cliPathFor(preferences, CLI_COMMAND[provider]) || "common install locations"}`;

  return (
    <Form
      isLoading={prompts === undefined || listLoading || thinkingLoading}
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
        text="Pick a saved prompt to start from it. Anything you type here is added after that template. Claude, ChatGPT, and Grok sign in from Add AI with browser OAuth. Ask uses the credential saved there."
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
            setModel(value === "anthropic" ? defaultModel : "");
            setModels([]);
            setListError(undefined);
            setOllamaThinking(undefined);
          }}
        >
          {PROVIDERS.map((item) => (
            <Form.Dropdown.Item key={item.id} value={item.id} title={item.title} />
          ))}
        </Form.Dropdown>
      )}
      {listError && provider === "anthropic" ? <Form.Description title="Sign-In" text={listError} /> : null}
      {provider === "apple" ? (
        <Form.Description title="Model" text={`Runs the “${appleShortcutName}” shortcut with the shortcuts command.`} />
      ) : provider === "anthropic" ? (
        <Form.TextField
          id="claudeModel"
          title="Model"
          value={model}
          placeholder="Leave blank for Claude's current model"
          info="Claude Code cannot list the models for this login. Leave this blank to use the model already selected in Claude Code, or type an id from /model."
          onChange={setModel}
        />
      ) : listLoading ? (
        <Form.Description title="Model" text="Checking which models this account can use…" />
      ) : models.length > 0 ? (
        <Form.Dropdown id="model" title="Model" value={modelValue} onChange={setModel}>
          {models.map((choice) => (
            <Form.Dropdown.Item key={choice.id} value={choice.id} title={choice.title} />
          ))}
        </Form.Dropdown>
      ) : (
        <Form.Description title="Model" text={listError ?? "This account returned no models."} />
      )}
      {statusMessage ? <Form.Description title="Thinking Levels" text={statusMessage} /> : null}
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
