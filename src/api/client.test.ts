import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@github/copilot-sdk", () => {
  return {
    CopilotClient: class MockCopilotClient {
      _token: string | undefined;
      constructor(opts: { githubToken?: string }) {
        this._token = opts.githubToken;
      }
    },
  };
});

describe("getClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns a client instance with correct token", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const { getClient } = await import("./client.js");
    const client = await getClient();
    expect(client).toBeDefined();
    expect((client as unknown as { _token: string })._token).toBe("test-token");
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    const { getClient } = await import("./client.js");
    const client1 = await getClient();
    const client2 = await getClient();
    expect(client1).toBe(client2);
  });
});
