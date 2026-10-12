import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { commandErrorText, runCommand } from "./process";

export async function runAppleShortcut(input: {
  name: string;
  prompt: string;
  binary: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("Ask Apple Intelligence needs macOS and the Shortcuts app.");
  }
  const shortcut = input.name.trim();
  if (!shortcut) {
    throw new Error("Set the Apple Intelligence shortcut name in extension preferences.");
  }

  const directory = await mkdtemp(join(tmpdir(), "personal-ai-"));
  const inputPath = join(directory, "input.txt");
  const outputPath = join(directory, "output.txt");
  try {
    await writeFile(inputPath, input.prompt, "utf8");
    try {
      await runCommand(
        input.binary,
        ["run", shortcut, "--input-path", inputPath, "--output-path", outputPath, "--output-type", "public.plain-text"],
        { signal: input.signal },
      );
    } catch (error) {
      if (input.signal?.aborted) throw error;
      throw new Error(formatShortcutError(shortcut, error));
    }
    const output = await readFile(outputPath, "utf8").catch(() => "");
    if (!output.trim()) {
      throw new Error(
        `The shortcut “${shortcut}” finished without any text. Make it receive text, call Apple Intelligence, and end with Stop and Output.`,
      );
    }
    return output.trim();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function formatShortcutError(shortcut: string, error: unknown): string {
  const detail = commandErrorText(error);
  if (/enoent/i.test(detail) || (/not found/i.test(detail) && /shortcuts/i.test(detail))) {
    return "The shortcuts command isn't available. Apple Intelligence handoff needs the macOS Shortcuts app.";
  }
  if (/could not find|couldn't find|does not exist|doesn't exist|no such shortcut|unable to find/i.test(detail)) {
    return `Shortcuts couldn't find “${shortcut}”. Create a shortcut with that exact name, set it to receive text, and return text with Stop and Output.`;
  }
  return `The shortcut “${shortcut}” failed. ${detail}`;
}
