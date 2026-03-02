import { describe, it, expect } from "vitest";
import { testChat, testSummarize, API_TIMEOUT_MS } from "./helpers.js";

const deployedUrl = process.env.AZURE_CONTAINER_APP_WEB_URL?.replace(/\/$/, "");

describe.skipIf(!deployedUrl)("Deployed app verification", () => {
  it("health check returns ok", async () => {
    const response = await fetch(`${deployedUrl}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.ok).toBe(true);
    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("ok");
  });

  it("streams chat response with content and DONE", async () => {
    await testChat(deployedUrl!);
  });

  it("returns a non-empty summary", { retry: 4 }, async () => {
    await testSummarize(deployedUrl!);
  });
});
