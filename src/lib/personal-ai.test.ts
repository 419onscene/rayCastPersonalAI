import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatShortcutError } from "./apple";
import { candidatePaths, expandCliPath, resolveCliBinary } from "./binaries";
import { buildProviderCommand } from "./cli-command";
import { isAuthFailure, loginArgs, loginRequiredMessage } from "./cli-login";
import { createOllamaPlainParser, deltasFromClaudeLine, deltasFromCodexLine, deltasFromGrokLine } from "./cli-output";
import { composePrompt } from "./compose-prompt";
import { chatGptPasteScript, chatgptDesktopUrl, claudeDesktopUrl, CLAUDE_PROMPT_LIMIT } from "./desktop";
import {
  CLAUDE_MODELS_UNAVAILABLE,
  emptyModelListMessage,
  modelListInvocation,
  parseCodexModels,
  parseGrokModels,
  parseModelList,
  selectAccountModel,
} from "./models";
import { ollamaThinkingFromOutput, parseOllamaList } from "./ollama";
import { parsePrompts } from "./prompt-json";
import { renderReply } from "./render-reply";
import { offeredLevel, selectThinking, thinkingCatalog } from "./thinking";
import { type ProviderId, type ReplyDelta } from "./types";

describe("composePrompt", () => {
  it("appends typed text to a saved template", () => {
    assert.equal(composePrompt("Summarize this:", "the launch notes"), "Summarize this:\n\nthe launch notes");
  });

  it("uses whichever side is present", () => {
    assert.equal(composePrompt("  Only template  ", "  "), "Only template");
    assert.equal(composePrompt(undefined, "  Just typed  "), "Just typed");
  });

  it("returns an empty string when both sides are blank", () => {
    assert.equal(composePrompt("  ", " \n"), "");
  });
});

describe("thinking catalogs", () => {
  it("lists Claude effort only for models in the Claude Code table", () => {
    const opus = thinkingCatalog("anthropic", "claude-opus-5-5");
    assert.deepEqual(
      opus.levels.map((level) => level.id),
      ["low", "medium", "high", "xhigh", "max"],
    );
    assert.equal(opus.defaultLevel, "medium");

    const older = thinkingCatalog("anthropic", "claude-opus-4-6");
    assert.deepEqual(
      older.levels.map((level) => level.id),
      ["low", "medium", "high", "max"],
    );
    assert.equal(thinkingCatalog("anthropic", "claude-opus-4-7").defaultLevel, "xhigh");
    assert.equal(thinkingCatalog("anthropic", "claude-fable-5-1").defaultLevel, "high");
    assert.equal(thinkingCatalog("anthropic", "custom-claude").levels.length, 0);
  });

  it("lists Codex levels from the ChatGPT models page", () => {
    assert.deepEqual(
      thinkingCatalog("openai", "gpt-6-astra").levels.map((level) => level.id),
      ["low", "medium", "high", "xhigh"],
    );
    assert.equal(thinkingCatalog("openai", "gpt-6-astra").defaultLevel, "low");
    assert.deepEqual(
      thinkingCatalog("openai", "gpt-6.1-sol").levels.map((level) => level.id),
      ["low", "medium", "high", "xhigh", "max", "ultra"],
    );
    assert.deepEqual(
      thinkingCatalog("openai", "gpt-6-luna").levels.map((level) => level.id),
      ["low", "medium", "high", "xhigh", "max"],
    );
    assert.equal(thinkingCatalog("openai", "gpt-6-sol").levels.length, 0);
    assert.equal(thinkingCatalog("openai", "gpt-5.4").levels.length, 0);
  });

  it("lists Grok effort from the reasoning docs and skips models that are not listed", () => {
    assert.deepEqual(
      thinkingCatalog("xai", "grok-4.7").levels.map((level) => level.id),
      ["low", "medium", "high", "xhigh"],
    );
    assert.equal(thinkingCatalog("xai", "grok-4.7").defaultLevel, "high");
    assert.deepEqual(
      thinkingCatalog("xai", "grok-4.5").levels.map((level) => level.id),
      ["low", "medium", "high"],
    );
    assert.equal(thinkingCatalog("xai", "grok-4.3").levels.length, 0);
    assert.deepEqual(
      thinkingCatalog("xai", "grok-4.20-multi-agent").levels.map((level) => level.id),
      ["low", "medium", "high", "xhigh"],
    );
  });

  it("uses only the levels Ollama reported, and the documented GPT-OSS set when show is silent", () => {
    const reported = thinkingCatalog("ollama", "qwen3", {
      values: ["low", "medium", "high"],
      defaultValue: "medium",
      reported: true,
    });
    assert.deepEqual(
      reported.levels.map((level) => level.id),
      ["low", "medium", "high"],
    );
    const silent = thinkingCatalog("ollama", "qwen3", { values: [], reported: false });
    assert.equal(silent.levels.length, 0);
    assert.match(silent.note ?? "", /won't pass --think/);
  });

  it("uses reported effort levels and does not fall back when that list is empty", () => {
    const reported = thinkingCatalog("openai", "gpt-6-astra", {
      values: ["minimal", "low", "none"],
      defaultValue: "minimal",
      reported: true,
    });
    assert.deepEqual(
      reported.levels.map((level) => level.id),
      ["minimal", "low"],
    );
    assert.equal(reported.defaultLevel, "minimal");
    const empty = thinkingCatalog("openai", "gpt-6-astra", { values: [], reported: true });
    assert.equal(empty.levels.length, 0);
    assert.match(empty.note ?? "", /reported no thinking levels/);
    assert.equal(thinkingCatalog("xai", "grok-4.7").levels.length > 0, true);
  });

  it("does not offer Off, and does not keep a level the next model lacks", () => {
    const samples: [ProviderId, string][] = [
      ["anthropic", "claude-opus-5-5"],
      ["anthropic", "claude-opus-4-6"],
      ["openai", "gpt-6-astra"],
      ["openai", "gpt-6.1-sol"],
      ["openai", "gpt-6-luna"],
      ["xai", "grok-4.7"],
      ["xai", "grok-4.5"],
      ["xai", "grok-4.20-multi-agent"],
    ];
    for (const [provider, model] of samples) {
      const ids = thinkingCatalog(provider, model).levels.map((level) => level.id);
      assert.equal(ids.includes("off"), false);
      assert.equal(ids.includes("none"), false);
    }
    const claude = thinkingCatalog("anthropic", "claude-opus-5-5");
    const grok = thinkingCatalog("xai", "grok-4.5");
    assert.equal(selectThinking(grok, "", "xhigh"), "high");
    assert.equal(selectThinking(claude, "low", "high"), "high");
    assert.equal(offeredLevel(claude, "off"), undefined);
    assert.equal(offeredLevel(grok, "xhigh"), undefined);
  });

  it("does not invent an Apple Intelligence thinking control", () => {
    const catalog = thinkingCatalog("apple", "");
    assert.equal(catalog.levels.length, 0);
    assert.match(catalog.note ?? "", /no thinking control/);
  });
});

describe("cli commands", () => {
  it("calls claude with effort only when that model offers it", () => {
    const command = buildProviderCommand({
      provider: "anthropic",
      model: "claude-opus-5-5",
      thinking: "xhigh",
      prompt: "Hello",
    });
    assert.equal(command.command, "claude");
    assert.ok(command.args.includes("--effort"));
    assert.equal(command.args[command.args.indexOf("--effort") + 1], "xhigh");
    assert.ok(command.args.includes("--tools"));
    const omitted = buildProviderCommand({
      provider: "anthropic",
      model: "claude-opus-4-6",
      thinking: "xhigh",
      prompt: "Hello",
    });
    assert.equal(omitted.args.includes("--effort"), false);
    assert.equal(command.args.join(" ").includes("api.anthropic.com"), false);
    const current = buildProviderCommand({
      provider: "anthropic",
      model: "  ",
      thinking: "",
      prompt: "Hello",
    });
    assert.equal(current.args.includes("--model"), false);
    assert.equal(current.args.includes("--effort"), false);
  });

  it("calls codex exec and does not send Ultra for Luna", () => {
    const luna = buildProviderCommand({
      provider: "openai",
      model: "gpt-6-luna",
      thinking: "ultra",
      prompt: "Hello",
    });
    assert.equal(luna.command, "codex");
    assert.equal(luna.args[0], "exec");
    assert.equal(luna.args.includes("--config"), false);
    const sol = buildProviderCommand({
      provider: "openai",
      model: "gpt-6.1-sol",
      thinking: "ultra",
      prompt: "Hello",
    });
    assert.ok(sol.args.includes('model_reasoning_effort="ultra"'));
    assert.equal(sol.args.join(" ").includes("api.openai.com"), false);
  });

  it("calls grok with --effort and never sends off", () => {
    const command = buildProviderCommand({
      provider: "xai",
      model: "grok-4.7",
      thinking: "off",
      prompt: "Hello",
    });
    assert.equal(command.command, "grok");
    assert.equal(command.args[0], "-p");
    assert.equal(command.args.includes("--effort"), false);
    const high = buildProviderCommand({
      provider: "xai",
      model: "grok-4.5",
      thinking: "high",
      prompt: "Hello",
    });
    assert.equal(high.args[high.args.indexOf("--effort") + 1], "high");
  });

  it("calls ollama run with a reported level and does not rename extra high to max", () => {
    const command = buildProviderCommand({
      provider: "ollama",
      model: "qwen3",
      thinking: "xhigh",
      prompt: "Hello",
      thinkingLevels: ["low", "medium", "high"],
    });
    assert.equal(command.command, "ollama");
    assert.equal(command.args.includes("--think=xhigh"), false);
    assert.equal(command.args.includes("--think=max"), false);
    const medium = buildProviderCommand({
      provider: "ollama",
      model: "qwen3",
      thinking: "medium",
      prompt: "Hello",
      thinkingLevels: ["low", "medium", "high"],
    });
    assert.ok(medium.args.includes("--think=medium"));
  });
});

describe("binary resolution", () => {
  it("uses the preference path before common install locations", () => {
    const home = "/Users/ada";
    const resolved = resolveCliBinary({
      command: "claude",
      preferencePath: "/opt/custom/claude",
      home,
      exists: (path) => path === "/opt/custom/claude" || path === `${home}/.local/bin/claude`,
    });
    assert.deepEqual(resolved, { path: "/opt/custom/claude" });
  });

  it("replaces <your-user-name> and keeps searching when that file is missing", () => {
    const home = "/Users/ada";
    assert.equal(expandCliPath("/Users/<your-user-name>/.local/bin/claude", home), `${home}/.local/bin/claude`);
    const resolved = resolveCliBinary({
      command: "claude",
      preferencePath: "/Users/<your-user-name>/.local/bin/claude",
      home,
      exists: (path) => path === "/opt/homebrew/bin/claude",
    });
    assert.deepEqual(resolved, { path: "/opt/homebrew/bin/claude" });
  });

  it("uses the prefilled home path when that file exists", () => {
    const resolved = resolveCliBinary({
      command: "claude",
      preferencePath: "/Users/<your-user-name>/.local/bin/claude",
      home: "/Users/ada",
      exists: (path) => path === "/Users/ada/.local/bin/claude",
    });
    assert.deepEqual(resolved, { path: "/Users/ada/.local/bin/claude" });
  });

  it("finds a CLI on the shell PATH when the prefilled file is missing", () => {
    const resolved = resolveCliBinary({
      command: "codex",
      preferencePath: "/Users/<your-user-name>/.local/bin/codex",
      home: "/Users/ada",
      pathDirs: ["/Users/ada/.nvm/versions/node/v22/bin"],
      exists: (path) => path === "/Users/ada/.nvm/versions/node/v22/bin/codex",
    });
    assert.deepEqual(resolved, { path: "/Users/ada/.nvm/versions/node/v22/bin/codex" });
  });

  it("names the browser sign-in command when a CLI is logged out", () => {
    assert.deepEqual(loginArgs("claude"), ["auth", "login"]);
    assert.deepEqual(loginArgs("codex"), ["login"]);
    assert.deepEqual(loginArgs("grok"), ["login"]);
    assert.equal(isAuthFailure("Please sign in with codex login"), true);
    assert.match(loginRequiredMessage("claude"), /claude auth login/);
    assert.match(loginRequiredMessage("claude"), /Finish that sign-in/);
  });

  it("checks common locations when the preference is blank", () => {
    const home = "/Users/ada";
    const resolved = resolveCliBinary({
      command: "codex",
      preferencePath: "  ",
      home,
      exists: (path) => path === "/opt/homebrew/bin/codex",
    });
    assert.deepEqual(resolved, { path: "/opt/homebrew/bin/codex" });
    assert.deepEqual(candidatePaths("ollama", home)[2], "/Applications/Ollama.app/Contents/Resources/ollama");
  });

  it("reports a missing CLI and does not mention an API key", () => {
    const resolved = resolveCliBinary({
      command: "grok",
      preferencePath: "",
      home: "/Users/ada",
      exists: () => false,
    });
    assert.ok("error" in resolved);
    if (!("error" in resolved)) return;
    assert.match(resolved.error, /`grok` isn't available/);
    assert.match(resolved.error, /does not fall back to an API key/);
    assert.doesNotMatch(resolved.error, /add your|password|https?:\/\//i);
  });
});

describe("cli output", () => {
  it("reads Claude stream-json text and thinking deltas", () => {
    assert.deepEqual(
      deltasFromClaudeLine(
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Hmm"}}}',
      ),
      [{ kind: "thinking", text: "Hmm" }],
    );
    assert.deepEqual(
      deltasFromClaudeLine(
        '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}',
      ),
      [{ kind: "text", text: "Hi" }],
    );
  });

  it("reads Codex agent messages and Grok streaming events", () => {
    assert.deepEqual(deltasFromCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}'), [
      { kind: "text", text: "Done" },
    ]);
    assert.deepEqual(deltasFromGrokLine('{"type":"thought","data":"Step"}'), [{ kind: "thinking", text: "Step" }]);
    assert.deepEqual(deltasFromGrokLine('{"type":"text","data":"Answer"}'), [{ kind: "text", text: "Answer" }]);
  });

  it("splits an Ollama thinking trace from the answer", () => {
    const deltas: ReplyDelta[] = [];
    const parser = createOllamaPlainParser((delta) => deltas.push(delta));
    parser.push("Thinking...\nCount the letters\n...done thinking.\n\nThree");
    parser.flush();
    assert.deepEqual(deltas, [
      { kind: "thinking", text: "Count the letters\n" },
      { kind: "text", text: "Three" },
    ]);
  });
});

describe("account model lists", () => {
  it("names the command each CLI uses to list models", () => {
    assert.deepEqual(modelListInvocation("openai"), { command: "codex", args: ["debug", "models"] });
    assert.deepEqual(modelListInvocation("xai"), { command: "grok", args: ["models"] });
    assert.deepEqual(modelListInvocation("ollama"), { command: "ollama", args: ["list"] });
    const claude = modelListInvocation("anthropic");
    assert.ok("error" in claude);
    if ("error" in claude) {
      assert.equal(claude.error, CLAUDE_MODELS_UNAVAILABLE);
      assert.match(claude.error, /will not substitute a built-in model catalog/);
    }
    const apple = modelListInvocation("apple");
    assert.ok("error" in apple);
    if ("error" in apple) assert.match(apple.error, /no model menu/);
  });

  it("reads Codex picker models and their reported efforts", () => {
    const models = parseCodexModels(
      JSON.stringify({
        models: [
          {
            slug: "gpt-hidden",
            display_name: "Hidden",
            visibility: "hide",
            supported_reasoning_levels: ["low", "high"],
            priority: 100,
          },
          {
            slug: "gpt-6-luna",
            display_name: "Luna",
            visibility: "list",
            supported_in_api: false,
            supported_reasoning_levels: ["low", "medium", "extra_high", "none"],
            default_reasoning_level: "medium",
            priority: 2,
          },
          {
            slug: "gpt-6-sol",
            display_name: "Sol",
            visibility: "list",
            priority: 5,
          },
          {
            model: "gpt-default",
            display_name: "Default",
            is_default: true,
            show_in_picker: true,
            supported_reasoning_efforts: [{ effort: "low", description: "Light" }],
            default_reasoning_effort: "low",
            priority: 0,
          },
          { slug: "gpt-quiet", visibility: "none" },
          { slug: "gpt-api-only", show_in_picker: false, supported_reasoning_levels: ["high"] },
        ],
      }),
    );
    assert.deepEqual(
      models.map((model) => model.id),
      ["gpt-default", "gpt-6-sol", "gpt-6-luna"],
    );
    assert.equal(models[0]?.default, true);
    assert.deepEqual(models[0]?.efforts?.values, ["low"]);
    assert.equal(models[1]?.efforts, undefined);
    assert.deepEqual(models[2]?.efforts?.values, ["low", "medium", "xhigh"]);
    assert.equal(models[2]?.efforts?.defaultValue, "medium");
    assert.equal(models[2]?.efforts?.reported, true);
  });

  it("treats an empty Codex effort list as a report", () => {
    const models = parseCodexModels(
      JSON.stringify({ models: [{ slug: "gpt-6-astra", supported_reasoning_levels: ["off", "none"] }] }),
    );
    assert.equal(models[0]?.efforts?.reported, true);
    assert.deepEqual(models[0]?.efforts?.values, []);
  });

  it("reads Grok JSON, including a string list, and plain text", () => {
    const jsonModels = parseGrokModels(
      JSON.stringify({
        models: [
          { id: "grok-4.7", display_name: "Grok 4.7", reasoning_efforts: ["low", "high", "false"] },
          { id: "grok-hidden", user_selectable: false },
          "grok-4.5",
        ],
      }),
    );
    assert.deepEqual(
      jsonModels.map((model) => model.id),
      ["grok-4.7", "grok-4.5"],
    );
    assert.deepEqual(jsonModels[0]?.efforts?.values, ["low", "high"]);
    assert.equal(jsonModels[1]?.efforts, undefined);

    const textModels = parseGrokModels("MODEL\ngrok-4.6  Grok 4.6\n(not a model)\n");
    assert.deepEqual(
      textModels.map((model) => model.id),
      ["grok-4.6"],
    );
    assert.equal(textModels[0]?.title, "Grok 4.6");
    assert.equal(parseGrokModels("!!!\n(no models)\n").length, 0);
  });

  it("reads installed Ollama names from ollama list", () => {
    assert.deepEqual(
      parseModelList("ollama", "NAME ID SIZE MODIFIED\nllama3.2:latest abc 2GB yesterday\n").map((model) => model.id),
      ["llama3.2:latest"],
    );
  });

  it("selects a default only when the account list contains it", () => {
    const models = [
      { id: "llama3.2", title: "llama3.2" },
      { id: "qwen3", title: "qwen3", default: true },
    ];
    assert.equal(selectAccountModel(models, "missing-model", "llama3.2"), "llama3.2");
    assert.equal(selectAccountModel(models, "missing-model"), "qwen3");
    assert.equal(selectAccountModel(models, "llama3.2"), "llama3.2");
    assert.equal(selectAccountModel([], "claude-opus-5-5"), "");
  });

  it("says an empty or failed list is not replaced with a built-in catalog", () => {
    assert.match(emptyModelListMessage("openai"), /`codex debug models` returned no models/);
    assert.match(emptyModelListMessage("xai"), /`grok models` returned no models/);
    assert.match(emptyModelListMessage("ollama"), /`ollama list` returned no models/);
    assert.match(emptyModelListMessage("openai"), /no built-in model list is substituted/);
    assert.equal(emptyModelListMessage("anthropic"), CLAUDE_MODELS_UNAVAILABLE);
  });
});

describe("ollama cli text", () => {
  it("parses ollama list and skips the header", () => {
    const names = parseOllamaList(
      "NAME ID SIZE MODIFIED\nllama3.2:latest abc 2GB yesterday\n\ngpt-oss:20b def 10GB today\n",
    );
    assert.deepEqual(names, ["llama3.2:latest", "gpt-oss:20b"]);
  });

  it("reads thinking.values and drops off-style entries", () => {
    const report = ollamaThinkingFromOutput(
      "qwen3",
      JSON.stringify({ thinking: { values: ["low", "medium", "high", false, "off"], default: "medium" } }),
    );
    assert.deepEqual(report.values, ["low", "medium", "high"]);
    assert.equal(report.defaultValue, "medium");
    assert.equal(report.reported, true);
  });

  it("uses the documented GPT-OSS levels when show does not print them", () => {
    const report = ollamaThinkingFromOutput("gpt-oss:20b", " Model\n architecture llama\n");
    assert.deepEqual(report.values, ["low", "medium", "high"]);
    assert.equal(report.defaultValue, "medium");
  });

  it("does not invent levels for a model show didn't describe", () => {
    const report = ollamaThinkingFromOutput("llama3.2", " Model\n architecture llama\n");
    assert.deepEqual(report.values, []);
    assert.equal(report.reported, false);
  });
});

describe("errors and storage", () => {
  it("ignores corrupt saved prompts", () => {
    assert.deepEqual(parsePrompts("nope"), []);
    assert.equal(parsePrompts(JSON.stringify([{ id: "1", name: "A", body: "B", updatedAt: 2 }])).length, 1);
  });

  it("names a missing Apple Intelligence shortcut", () => {
    assert.match(formatShortcutError("Ask Apple Intelligence", new Error("Could not find shortcut")), /couldn't find/i);
  });
});

describe("desktop handoff", () => {
  it("builds the Claude new-chat URL and truncates long prompts", () => {
    const prompt = "Hello Claude";
    assert.equal(claudeDesktopUrl(prompt).url, "claude://claude.ai/new?q=Hello%20Claude");
    const long = "a".repeat(CLAUDE_PROMPT_LIMIT + 20);
    const result = claudeDesktopUrl(long);
    assert.equal(result.truncated, true);
    assert.equal(decodeURIComponent(result.url.split("q=")[1]).length, CLAUDE_PROMPT_LIMIT);
  });

  it("pastes into ChatGPT without sending the message", () => {
    const script = chatGptPasteScript("/tmp/personal-ai/prompt.txt");
    assert.match(script, /tell application "ChatGPT"/);
    assert.match(script, /keystroke "v"/);
    assert.doesNotMatch(script, /keystroke return/);
    assert.equal(chatgptDesktopUrl("Hi there"), "chatgpt://chatgpt.com/?q=Hi%20there");
  });
});

describe("reply view", () => {
  it("shows loading, the answer, and an empty result", () => {
    assert.match(renderReply(view({ pending: true })), /Sending your prompt/);
    assert.match(renderReply(view({ pending: false, answer: "Done" })), /Done/);
    assert.match(renderReply(view({ pending: false })), /empty reply/);
  });

  it("shows a provider failure before any text arrives", () => {
    assert.match(renderReply(view({ pending: false, error: "`codex` isn't available." })), /Couldn't get a reply/);
  });
});

function view(overrides: Partial<Parameters<typeof renderReply>[0]>): Parameters<typeof renderReply>[0] {
  return {
    thinking: "",
    answer: "",
    providerLabel: "ChatGPT",
    model: "gpt-6-luna",
    thinkingLabel: "High",
    pending: false,
    ...overrides,
  };
}
