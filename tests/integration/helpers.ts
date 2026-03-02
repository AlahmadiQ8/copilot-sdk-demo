import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { expect } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const API_DIR = join(REPO_ROOT, "src", "api");
export const HEALTH_TIMEOUT_MS = 30_000;
export const API_TIMEOUT_MS = 120_000;

export interface ModelConfig {
  name: string;
  port: number;
  env: Record<string, string | undefined>;
}

/**
 * Build a clean env object: inherit parent env, strip model vars,
 * set NODE_ENV=test, then apply overrides.
 */
export function getCleanEnv(
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;

  delete env.MODEL_PROVIDER;
  delete env.MODEL_NAME;
  delete env.AZURE_OPENAI_ENDPOINT;

  env.NODE_ENV = "test";

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

export function spawnServer(config: ModelConfig): ChildProcess {
  const env = getCleanEnv({ PORT: config.port.toString(), ...config.env });
  const debug = process.env.DEBUG === "1";

  const child = spawn("node", ["--import", "tsx", "index.ts"], {
    cwd: API_DIR,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Consume stdout/stderr to prevent pipe buffer pressure on Windows
  child.stdout?.on("data", (chunk: Buffer) => {
    if (debug) process.stdout.write(`[${config.name}:out] ${chunk}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (debug) process.stderr.write(`[${config.name}:err] ${chunk}`);
  });

  return child;
}

export function killServer(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

export async function waitForHealth(
  port: number,
  timeoutMs: number = HEALTH_TIMEOUT_MS,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === "ok") return true;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return false;
}

export async function readSseStream(
  response: Response,
): Promise<{ contents: string[]; hasDone: boolean }> {
  const contents: string[] = [];
  let hasDone = false;

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!; // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();

      if (payload === "[DONE]") {
        hasDone = true;
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as { content?: string };
        if (parsed.content !== undefined) {
          contents.push(parsed.content);
        }
      } catch {
        // skip non-JSON data lines
      }
    }
  }

  return { contents, hasDone };
}

export async function testChat(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Say hello in one word" }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  expect(response.ok).toBe(true);

  const { contents, hasDone } = await readSseStream(response);

  expect(contents.length).toBeGreaterThan(0);
  expect(hasDone).toBe(true);
}

export async function testSummarize(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "The quick brown fox jumps over the lazy dog. It was a sunny day in the park. Children were playing and birds were singing.",
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  expect(response.ok).toBe(true);

  const body = (await response.json()) as { summary?: string };
  expect(typeof body.summary).toBe("string");
  expect(body.summary!.length).toBeGreaterThan(0);
}
