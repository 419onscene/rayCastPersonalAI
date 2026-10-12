import { spawn } from "child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options?: { input?: string; signal?: AbortSignal },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], signal: options?.signal });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error((stderr || stdout).trim() || `${command} exited with code ${code ?? "unknown"}`);
      reject(error);
    });
    child.stdin.end(options?.input ?? "");
  });
}

export function commandErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
