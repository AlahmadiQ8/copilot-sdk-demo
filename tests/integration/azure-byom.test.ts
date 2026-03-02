import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { type ChildProcess } from "child_process";
import { spawnServer, killServer, waitForHealth, testChat, testSummarize } from "./helpers.js";

const PORT = 9103;
const BASE_URL = `http://localhost:${PORT}`;

const azureConfigured = !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_MODEL_NAME);

describe.skipIf(!azureConfigured)("Azure BYOM model path", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawnServer({
      name: "azure-byom",
      port: PORT,
      env: {
        MODEL_PROVIDER: "azure",
        MODEL_NAME: process.env.AZURE_MODEL_NAME,
        AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
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
