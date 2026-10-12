# Personal AI

A macOS [Raycast](https://www.raycast.com/) extension for asking the AI accounts you already signed in to, and reading the reply inside Raycast. Ask commands call the official local CLIs. They do not call provider HTTP APIs and they do not use API keys. Apple Intelligence is reached through a Shortcut. Desktop commands still open the Claude and ChatGPT apps with the prompt filled in.

This extension does not use Raycast AI or `@raycast/api` AI helpers.

The extension lives at the repository root. It follows the official Raycast layout: a `package.json` manifest, one `src/<command>.tsx` entry per command, and `assets/icon.png`.

## Install in Raycast

Requires macOS and [Node.js 22.22 or newer](https://nodejs.org/).

```bash
npm install
npm run dev
```

`npm run dev` registers the extension with Raycast in development mode. Open Raycast and run **Ask**. Leave that process running while you change the extension. `npm run build` typechecks and creates a production build. `npm test` runs the local mapping tests.

This repository was typechecked with `tsc` and its unit tests on Linux. It was not launched inside the Raycast app, because this environment is not a Mac.

## Free plan

Custom extensions and public Store extensions run on Raycast Free. Pro is required for Raycast AI, not for installing or running an ordinary extension.

The Raycast Manual's billing page says Raycast Free includes browsing thousands of extensions, creating extensions, and Raycast's developer tooling, and that AI features are not included in Raycast Free: [Billing](https://manual.raycast.com/billing). The pricing page says the individual plan is not charged and provides access to all public extensions built by the community: [Pricing](https://www.raycast.com/pricing).

## Aliases and hotkeys

Raycast does not let an extension set its own hotkeys. After the extension is installed:

1. Open **Raycast Settings → Extensions**.
2. Select **Personal AI**.
3. Choose a command, such as **Ask**, **Ask Claude**, or **Open in ChatGPT**.
4. Click **Record Hotkey** for a shortcut, or set an **Alias** so you can launch it by a short name from root search.

Each command is declared separately so you can bind them independently:

| Command                | What it does                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| Ask                    | Prompt window. Provider, model, and thinking start from your preferences and can be changed for that run. |
| Ask Claude             | Same window, locked to Claude. Calls `claude`.                                                            |
| Ask ChatGPT            | Locked to ChatGPT. Calls `codex`, the Codex CLI.                                                          |
| Ask Grok               | Locked to Grok. Calls `grok`.                                                                             |
| Ask Ollama             | Locked to Ollama. Lists models with `ollama ls`.                                                          |
| Ask Apple Intelligence | Locked to your Shortcut. Calls `shortcuts`.                                                               |
| Open in Claude         | Opens the Claude desktop app with the prompt filled in.                                                   |
| Open in ChatGPT        | Opens the ChatGPT desktop app and pastes the prompt into a new chat.                                      |
| Manage Saved Prompts   | Create, edit, and delete templates.                                                                       |

## Local CLIs

Raycast does not inherit your shell PATH. Each Ask command looks for a preference path first, then common install locations. If the binary is missing, the reply says so. There is no API-key fallback.

| Provider           | Binary      | What it runs                                                                                                 |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| Claude             | `claude`    | `claude -p` with `--model`, `--output-format stream-json`, and `--effort` when the model lists effort.       |
| ChatGPT            | `codex`     | `codex exec` with `-m`, `--json`, a read-only sandbox, and `model_reasoning_effort` when the model lists it. |
| Grok               | `grok`      | `grok -p` with `--model`, `--output-format streaming-json`, and `--effort` when the model lists it.          |
| Ollama             | `ollama`    | `ollama run` with `--think=<level>` only when that model reported the level.                                 |
| Apple Intelligence | `shortcuts` | `shortcuts run` with an input file and an output file.                                                       |

ChatGPT uses the Codex CLI. That is the official local CLI you sign in to with ChatGPT (`codex exec`, documented at [Non-interactive mode](https://developers.openai.com/codex/noninteractive) and [Models](https://learn.chatgpt.com/docs/models)). This extension does not call a separate ChatGPT HTTP API.

Grok uses the Grok CLI (`grok`), the official local CLI from the Grok build tools. Claude uses Claude Code (`claude`). Ollama uses `ollama`.

Search order when the preference path is blank:

- Claude: `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`
- Codex: `~/.local/bin/codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`
- Grok: `~/.local/bin/grok`, `~/.grok/bin/grok`, `/opt/homebrew/bin/grok`, `/usr/local/bin/grok`
- Ollama: `/usr/local/bin/ollama`, `/opt/homebrew/bin/ollama`, `/Applications/Ollama.app/Contents/Resources/ollama`, `~/.local/bin/ollama`
- Shortcuts: `/usr/bin/shortcuts`

If you set a path and that file is missing, the command stops instead of silently using another binary.

Claude is started with `--tools` set to an empty list so the reply does not edit files. Codex runs `exec` in a read-only sandbox. Grok is limited to one turn. These CLIs are still the same programs you use in a terminal, so a future CLI release can change a flag. The reply shows the CLI's own error when that happens.

## Preferences

Open **Raycast Settings → Extensions → Personal AI**.

| Preference                  | Use                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Default Provider            | Used by **Ask** until you change the dropdown in the window.                             |
| Default Model               | Model id for the default provider. Leave blank to use that provider's recommended model. |
| Default Thinking            | A level id, such as `medium`. Applied only when the selected model offers it.            |
| Custom Model                | Extra model id added to the model dropdown for the provider you select.                  |
| Ollama Host                 | Optional `OLLAMA_HOST` for the `ollama` command. Leave blank for the CLI default.        |
| Apple Intelligence Shortcut | Shortcut name. Defaults to `Ask Apple Intelligence`.                                     |
| Claude CLI Path             | Optional full path to `claude`.                                                          |
| Codex CLI Path              | Optional full path to `codex`.                                                           |
| Grok CLI Path               | Optional full path to `grok`.                                                            |
| Ollama CLI Path             | Optional full path to `ollama`.                                                          |
| Shortcuts CLI Path          | Optional full path to `shortcuts`.                                                       |

There are no API-key preferences. Sign in with each CLI itself (`claude`, `codex`, `grok`, `ollama signin` when you use Ollama accounts).

## Saved prompts

Run **Manage Saved Prompts** to create, edit, or delete templates. They are stored in Raycast LocalStorage on this Mac.

In any Ask or desktop command, choose a saved prompt in the dropdown. The text you type in the window is appended after the template, separated by a blank line. You can send a template alone, typed text alone, or both. An empty form is rejected.

## Thinking

The thinking dropdown lists only the levels the selected model offers. Changing the model changes the dropdown. There is no Off level, and a level the model does not offer is not sent as a lower one.

If the model has no listed levels, the dropdown is hidden and the command does not pass a thinking flag. The CLI then uses its own default.

Claude levels come from [Claude Code model config](https://code.claude.com/docs/en/model-config). `ultracode` is a Claude Code setting, not a model level, so it is not in the dropdown.

| Model                                          | Levels                             | Default     |
| ---------------------------------------------- | ---------------------------------- | ----------- |
| Fable 5.1, Fable 5, Opus 5, Sonnet 5, Opus 4.8 | low, medium, high, extra high, max | high        |
| Opus 5.5, Sonnet 5.5, Haiku 5.5                | low, medium, high, extra high, max | medium      |
| Opus 4.7                                       | low, medium, high, extra high, max | extra high  |
| Opus 4.6, Sonnet 4.6                           | low, medium, high, max             | high        |
| Any other Claude model                         | none listed                        | CLI default |

ChatGPT levels come from [Models](https://learn.chatgpt.com/docs/models). The CLI names are `low` (Light), `medium`, `high`, `xhigh` (Extra high), `max`, and `ultra`. Max and Ultra are included only where that page says the model offers them. Ultra is Codex's subagent mode, passed as `model_reasoning_effort="ultra"`.

| Model                                 | Levels                                    | Default     |
| ------------------------------------- | ----------------------------------------- | ----------- |
| GPT-6 Astra                           | low, medium, high, extra high             | low         |
| GPT-6.1 Sol                           | low, medium, high, extra high, max, ultra | medium      |
| GPT-6 Luna                            | low, medium, high, extra high, max        | high        |
| GPT-6 Sol, GPT-5.6 Sol, and other ids | none listed on that page                  | CLI default |

Grok levels come from [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning). The CLI accepts more names than a given model advertises. This extension sends only the advertised ones, with `--effort`.

| Model                         | Levels                        | Default     |
| ----------------------------- | ----------------------------- | ----------- |
| Grok 4.7, Grok 4.6, Grok 4.20 | low, medium, high, extra high | high        |
| Grok 4.5                      | low, medium, high             | high        |
| Grok 4.3 and other ids        | none listed                   | CLI default |

Ollama levels come from `ollama show`. When that output includes a `thinking.values` list, the dropdown uses those names and drops `true`, `false`, `off`, and `none`. `--think` is set to the exact name. Extra high is not renamed to max. If show does not print the list, the dropdown stays hidden, except GPT-OSS: the Ollama docs say that model accepts `low`, `medium`, and `high`, with medium as the example default.

Apple Intelligence has no thinking dropdown.

Curated models:

- Claude: `claude-opus-5-5` (recommended), `claude-fable-5-1`, `claude-sonnet-5-5`, `claude-haiku-5-5`
- ChatGPT: `gpt-6-astra` (recommended), `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`
- Grok: `grok-4.7` (recommended), `grok-4.6`, `grok-4.5`, `grok-4.3`

`gpt-5.4` is not listed. Codex with ChatGPT sign-in retired it. Put any other id in **Custom Model** or **Default Model**. A custom id gets a thinking dropdown only when the docs above name that id.

## Desktop apps

**Open in Claude** checks that Claude is installed, then opens `claude://claude.ai/new?q=...`. Anthropic prefills the composer and does not send the message. Prompts longer than about 14,000 characters are cut, and the toast says so.

**Open in ChatGPT** checks that ChatGPT is installed. It activates the app, starts a new chat, and pastes the prompt without pressing Return. That needs Raycast allowed under **System Settings → Privacy & Security → Accessibility**. If macOS blocks typing, the command falls back to `chatgpt://chatgpt.com/?q=...` and copies the prompt to the clipboard. ChatGPT's desktop app does not document a prefill URL as clearly as Claude, so a build that ignores `q` will open without the text until you paste.

If either app is missing, the command stops with an error instead of opening a browser. These commands do not call `claude` or `codex`.

## Apple Intelligence

Apple does not offer a general third-party API for Apple Intelligence. This extension does not pretend to call an Apple model.

Create a Shortcut once:

1. Open **Shortcuts** and create a shortcut named exactly like the preference (`Ask Apple Intelligence` unless you changed it).
2. Set it to receive text input (enable **Use as Quick Action** and receive **Text**, or otherwise accept the input passed by `shortcuts run`).
3. Add Apple's on-device model action, such as **Use Model** under Apple Intelligence, and pass the shortcut input to it.
4. End with **Stop and Output**, returning plain text.
5. Confirm the name appears in `shortcuts list`.

**Ask Apple Intelligence** runs:

```bash
shortcuts run "Ask Apple Intelligence" --input-path <prompt> --output-path <reply> --output-type public.plain-text
```

The binary is the preference path, or `/usr/bin/shortcuts`. If the command is missing, the shortcut name does not exist, or the shortcut returns no text, the reply view explains what failed. The Shortcut uses whatever Apple Intelligence action you added. This extension cannot choose an Apple model, thinking budget, or Private Cloud Compute setting.

## Errors you will see

- The CLI binary is not in the preference path or the common install locations.
- The CLI is not signed in, or it exits with an error.
- Ollama has no installed models, or `ollama show` did not report thinking levels.
- Shortcut missing, or a shortcut that returns nothing.
- Claude or ChatGPT desktop app not installed.
- macOS Accessibility blocking the ChatGPT paste.

## Development

```bash
npm run typecheck
npm test
npm run lint
```

Change `author` in `package.json` to your Raycast username before publishing. `npm run lint` looks that name up on the Raycast Store, so it fails until the username exists. `npm run dev` and `npm run build` do not.
