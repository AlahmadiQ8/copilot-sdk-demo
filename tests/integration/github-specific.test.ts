import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { type ChildProcess } from "child_process";
import { spawnServer, killServer, waitForHealth, testChat, testSummarize } from "./helpers.js";

const PORT = 9102;
const BASE_URL = `http://localhost:${PORT}`;

describe("GitHub Specific model path (gpt-4o)", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawnServer({
      name: "github-specific",
      port: PORT,
      env: {
        MODEL_PROVIDER: undefined,
        MODEL_NAME: "gpt-4o",
        AZURE_OPENAI_ENDPOINT: undefined,
      },
    });

    const healthy = await waitForHealth(PORT);
    expect(healthy).toBe(true);
  }, 30_000);

  afterAll(async () => {
    if (server) await killServer(server);
  });

  it("streams chat response with content and DONE", async () => {
    await testChat(BASE_URL);
  });

  it("returns a non-empty summary", { retry: 4 }, async () => {
    await testSummarize(BASE_URL);
  });
});
