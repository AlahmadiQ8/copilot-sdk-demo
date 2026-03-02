import { describe, it, expect, vi, beforeEach } from "vitest";
import { isModelSupported, enhanceModelError, getSessionOptions, UNSUPPORTED_MODEL_MESSAGE } from "./model-config.js";

describe("isModelSupported", () => {
  it("accepts o3", () => expect(isModelSupported("o3")).toBe(true));
  it("accepts o3-mini", () => expect(isModelSupported("o3-mini")).toBe(true));
  it("accepts o4-mini", () => expect(isModelSupported("o4-mini")).toBe(true));
  it("accepts gpt-5", () => expect(isModelSupported("gpt-5")).toBe(true));
  it("accepts gpt-5-turbo", () => expect(isModelSupported("gpt-5-turbo")).toBe(true));
  it("accepts gpt-5.1", () => expect(isModelSupported("gpt-5.1")).toBe(true));
  it("accepts codex-mini", () => expect(isModelSupported("codex-mini")).toBe(true));
  it("accepts codex-mini-latest", () => expect(isModelSupported("codex-mini-latest")).toBe(true));

  it("rejects gpt-4o", () => expect(isModelSupported("gpt-4o")).toBe(false));
  it("rejects gpt-4.1", () => expect(isModelSupported("gpt-4.1")).toBe(false));
  it("rejects gpt-4", () => expect(isModelSupported("gpt-4")).toBe(false));
  it("rejects empty string", () => expect(isModelSupported("")).toBe(false));
  it("rejects random string", () => expect(isModelSupported("llama-3")).toBe(false));

  it("is case-insensitive", () => {
    expect(isModelSupported("O3")).toBe(true);
    expect(isModelSupported("GPT-5")).toBe(true);
    expect(isModelSupported("O4-Mini")).toBe(true);
  });
});

describe("enhanceModelError", () => {
  it("enhances encrypted content error", () => {
    const err = new Error("Encrypted content is not supported by this model");
    const result = enhanceModelError(err);
    expect(result.message).toContain("does not support encrypted content");
    expect(result.message).toContain("o4-mini");
  });

  it("passes through other errors unchanged", () => {
    const err = new Error("Network timeout");
    const result = enhanceModelError(err);
    expect(result.message).toBe("Network timeout");
    expect(result).toBe(err);
  });

  it("wraps non-Error inputs", () => {
    const result = enhanceModelError("string error");
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe("string error");
  });

  it("wraps null/undefined", () => {
    expect(enhanceModelError(null).message).toBe("null");
    expect(enhanceModelError(undefined).message).toBe("undefined");
  });
});

describe("UNSUPPORTED_MODEL_MESSAGE", () => {
  it("is a non-empty string", () => {
    expect(typeof UNSUPPORTED_MODEL_MESSAGE).toBe("string");
    expect(UNSUPPORTED_MODEL_MESSAGE.length).toBeGreaterThan(0);
  });
});

describe("getSessionOptions", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default options when no env vars set", async () => {
    vi.stubEnv("MODEL_PROVIDER", "");
    vi.stubEnv("MODEL_NAME", "");
    const opts = await getSessionOptions();
    expect(opts).toEqual({ streaming: false });
  });

  it("returns streaming option", async () => {
    vi.stubEnv("MODEL_PROVIDER", "");
    vi.stubEnv("MODEL_NAME", "");
    const opts = await getSessionOptions({ streaming: true });
    expect(opts).toEqual({ streaming: true });
  });

  it("returns model when MODEL_NAME is set (GitHub specific)", async () => {
    vi.stubEnv("MODEL_PROVIDER", "");
    vi.stubEnv("MODEL_NAME", "o4-mini");
    const opts = await getSessionOptions();
    expect(opts).toEqual({ model: "o4-mini", streaming: false });
  });

  it("throws when MODEL_PROVIDER=azure without endpoint", async () => {
    vi.stubEnv("MODEL_PROVIDER", "azure");
    vi.stubEnv("MODEL_NAME", "o4-mini");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "");
    await expect(getSessionOptions()).rejects.toThrow("AZURE_OPENAI_ENDPOINT and MODEL_NAME are required");
  });

  it("throws when MODEL_PROVIDER=azure without model name", async () => {
    vi.stubEnv("MODEL_PROVIDER", "azure");
    vi.stubEnv("MODEL_NAME", "");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "https://my.openai.azure.com");
    await expect(getSessionOptions()).rejects.toThrow("AZURE_OPENAI_ENDPOINT and MODEL_NAME are required");
  });

  it("returns Azure BYOM config when all env vars are set", async () => {
    vi.stubEnv("MODEL_PROVIDER", "azure");
    vi.stubEnv("MODEL_NAME", "o4-mini");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "https://my.openai.azure.com/");

    // Mock @azure/identity to avoid real credential calls
    vi.mock("@azure/identity", () => ({
      DefaultAzureCredential: class {
        async getToken() {
          return { token: "mock-bearer-token", expiresOnTimestamp: Date.now() + 3600_000 };
        }
      },
    }));

    const opts = await getSessionOptions({ streaming: true });
    expect(opts).toMatchObject({
      model: "o4-mini",
      streaming: true,
      provider: {
        type: "azure",
        baseUrl: "https://my.openai.azure.com", // trailing slash stripped
        bearerToken: "mock-bearer-token",
        wireApi: "responses",
        azure: { apiVersion: "2025-04-01-preview" },
      },
    });
  });
});
