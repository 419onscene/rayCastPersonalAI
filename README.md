# Personal AI

A macOS [Raycast](https://www.raycast.com/) extension for asking your own AI accounts and reading the reply inside Raycast. It talks to Claude, ChatGPT, Grok, and Ollama with your keys or local server. Apple Intelligence is reached through a Shortcut you configure. Desktop commands open the Claude and ChatGPT apps with the prompt filled in.

This extension does not use Raycast AI or `@raycast/api` AI helpers. API keys are Raycast password preferences. Nothing is hardcoded.

The extension lives at the repository root. It follows the official Raycast layout: a `package.json` manifest, one `src/<command>.tsx` entry per command, and `assets/icon.png`.

## Install in Raycast

Requires macOS and [Node.js 22.22 or newer](https://nodejs.org/).

```bash
npm install
npm run dev
```

`npm run dev` registers the extension with Raycast in development mode. Open Raycast and run **Ask**. Leave that process running while you change the extension. `npm run build` typechecks and creates a production build. `npm test` runs the local mapping tests.

This repository was typechecked with `tsc` and its unit tests on Linux. It was not launched inside the Raycast app, because this environment is not a Mac.

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
| Ask Claude             | Same window, locked to Claude.                                                                            |
| Ask ChatGPT            | Locked to ChatGPT.                                                                                        |
| Ask Grok               | Locked to Grok.                                                                                           |
| Ask Ollama             | Locked to Ollama. Loads models from the local server.                                                     |
| Ask Apple Intelligence | Locked to your Shortcut.                                                                                  |
| Open in Claude         | Opens the Claude desktop app with the prompt filled in.                                                   |
| Open in ChatGPT        | Opens the ChatGPT desktop app and pastes the prompt into a new chat.                                      |
| Manage Saved Prompts   | Create, edit, and delete templates.                                                                       |

## API keys and preferences

Open **Raycast Settings → Extensions → Personal AI**.

| Preference                  | Use                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Default Provider            | Used by **Ask** until you change the dropdown in the window.                             |
| Default Model               | Model id for the default provider. Leave blank to use that provider's recommended model. |
| Default Thinking            | Off, Low, Medium, High, or Extra high.                                                   |
| Custom Model                | Extra model id added to the model dropdown for the provider you select.                  |
| Ollama Base URL             | Defaults to `http://127.0.0.1:11434`.                                                    |
| Apple Intelligence Shortcut | Shortcut name. Defaults to `Ask Apple Intelligence`.                                     |
| Anthropic API Key           | Password. Required only when you ask Claude.                                             |
| OpenAI API Key              | Password. Required only when you ask ChatGPT.                                            |
| xAI API Key                 | Password. Required only when you ask Grok.                                               |

Ollama does not need a key. Keys are optional in the manifest so Ollama and Apple Intelligence commands still open when the cloud keys are empty. A missing key is reported in the reply view, with an action to open preferences.

## Saved prompts

Run **Manage Saved Prompts** to create, edit, or delete templates. They are stored in Raycast LocalStorage on this Mac.

In any Ask or desktop command, choose a saved prompt in the dropdown. The text you type in the window is appended after the template, separated by a blank line. You can send a template alone, typed text alone, or both. An empty form is rejected.

## Thinking

The thinking dropdown maps onto each provider's API:

| Level               | Claude                                                        | ChatGPT                   | Grok                      | Ollama                    |
| ------------------- | ------------------------------------------------------------- | ------------------------- | ------------------------- | ------------------------- |
| Off                 | `thinking: disabled` and low effort, when the model allows it | `reasoning_effort: none`  | low effort                | `think: false`            |
| Low / Medium / High | `output_config.effort` plus adaptive thinking                 | `reasoning_effort`        | `reasoning.effort`        | `think` set to that level |
| Extra high          | effort `xhigh`                                                | `reasoning_effort: xhigh` | `reasoning.effort: xhigh` | `think: max`              |

Some current models cannot turn thinking off. Claude Opus 5.5 and Claude Fable 5.1 stay on adaptive thinking, so Off is sent as low effort. Claude Sonnet 5.5 Off uses between-tools thinking. GPT-6 Astra and GPT-6.1 Sol have no `none` level, so Off is sent as `low`. Current Grok models cannot disable reasoning, so Off is sent as `low`. The reply says when a fallback was used.

Apple Intelligence ignores the thinking dropdown. The Shortcut runs as you built it.

Replies stream into the Raycast detail view for Claude, ChatGPT, Grok, and Ollama. Apple Intelligence returns the Shortcut's full text after it finishes. Output is capped (8k to 64k tokens depending on the thinking level) so a quick ask cannot run away. Anthropic and OpenAI also offer a `max` effort above extra high; this extension does not send that level.

Curated models:

- Claude: `claude-opus-5-5` (recommended), `claude-fable-5-1`, `claude-sonnet-5-5`, `claude-haiku-5-5`
- ChatGPT: `gpt-6-astra` (recommended), `gpt-6.1-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.4`
- Grok: `grok-4.7` (recommended), `grok-4.6`, `grok-4.5`, `grok-4.3`

Put any other id in **Custom Model** or **Default Model**.

## Desktop apps

**Open in Claude** checks that Claude is installed, then opens `claude://claude.ai/new?q=...`. Anthropic prefills the composer and does not send the message. Prompts longer than about 14,000 characters are cut, and the toast says so.

**Open in ChatGPT** checks that ChatGPT is installed. It activates the app, starts a new chat, and pastes the prompt without pressing Return. That needs Raycast allowed under **System Settings → Privacy & Security → Accessibility**. If macOS blocks typing, the command falls back to `chatgpt://chatgpt.com/?q=...` and copies the prompt to the clipboard. ChatGPT's desktop app does not document a prefill URL as clearly as Claude, so a build that ignores `q` will open without the text until you paste.

If either app is missing, the command stops with an error instead of opening a browser.

## Apple Intelligence

Apple does not offer a general third-party HTTP API for Apple Intelligence. This extension does not pretend to call an Apple model.

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

If the `shortcuts` command is missing, the shortcut name does not exist, or the shortcut returns no text, the reply view explains what failed. The Shortcut uses whatever Apple Intelligence action you added. This extension cannot choose an Apple model, thinking budget, or Private Cloud Compute setting.

## Errors you will see

- Missing API key, or a key the provider rejects.
- Ollama not running at the configured URL, or no installed models.
- Unknown model id.
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
