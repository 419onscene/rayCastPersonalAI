import { spawn } from "child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options?: { input?: string; signal?: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["pipe", "pipe", "pipe"],
      signal: options?.signal,
    });
    let settled = false;
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
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
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

export function streamCommand(
  command: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onStdout: (chunk: string) => void;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
    });
    let settled = false;
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.onStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (options.signal?.aborted) {
        resolve({ stdout, stderr });
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (options.signal?.aborted || code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(clip(stderr || stdout) || `${command} exited with code ${code ?? "unknown"}`);
      reject(error);
    });
    child.stdin.end();
  });
}

function clip(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 500 ? `${compact.slice(0, 500)}…` : compact;
}

export function commandErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
