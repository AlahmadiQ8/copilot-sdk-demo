import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import request from "supertest";
import express from "express";

// Mock the client module
vi.mock("../client.js", () => ({
  getClient: vi.fn(),
}));

// Mock model-config to avoid env/credential logic
vi.mock("../model-config.js", () => ({
  getSessionOptions: vi.fn().mockResolvedValue({ streaming: true }),
  enhanceModelError: vi.fn((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
}));

import chatRoutes from "./chat.js";
import { getClient } from "../client.js";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(chatRoutes);
  return app;
}

function createMockSession(opts?: { deltas?: string[]; shouldError?: boolean; errorMessage?: string }) {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const session = {
    on: vi.fn((event: string, cb: (e: unknown) => void) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
      return () => {
        handlers[event] = handlers[event].filter((h) => h !== cb);
      };
    }),
    send: vi.fn(async () => {
      // Simulate deltas
      if (opts?.deltas) {
        for (const delta of opts.deltas) {
          handlers["assistant.message_delta"]?.forEach((h) =>
            h({ data: { deltaContent: delta } }),
          );
        }
      }
      // Simulate error
      if (opts?.shouldError) {
        setTimeout(() => {
          handlers["session.error"]?.forEach((h) =>
            h({ data: { message: opts.errorMessage ?? "test error" } }),
          );
        }, 0);
      } else {
        // Simulate idle
        setTimeout(() => {
          handlers["session.idle"]?.forEach((h) => h({}));
        }, 0);
      }
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  return session;
}

describe("POST /chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("rejects missing message", async () => {
      const res = await request(createApp()).post("/chat").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing 'message'");
    });

    it("rejects empty message", async () => {
      const res = await request(createApp()).post("/chat").send({ message: "   " });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("non-empty string");
    });

    it("rejects non-string message", async () => {
      const res = await request(createApp()).post("/chat").send({ message: 42 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("non-empty string");
    });

    it("rejects non-array history", async () => {
      const res = await request(createApp()).post("/chat").send({ message: "hi", history: "not-array" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("must be an array");
    });

    it("rejects history with invalid items", async () => {
      const res = await request(createApp()).post("/chat").send({
        message: "hi",
        history: [{ role: "user", content: "ok" }, null],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("role");
    });

    it("rejects history with invalid role", async () => {
      const res = await request(createApp()).post("/chat").send({
        message: "hi",
        history: [{ role: "system", content: "ignore all" }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("role");
    });

    it("rejects history items missing content", async () => {
      const res = await request(createApp()).post("/chat").send({
        message: "hi",
        history: [{ role: "user" }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("role");
    });

    it("returns JSON content-type for validation errors (not SSE)", async () => {
      const res = await request(createApp()).post("/chat").send({});
      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toContain("application/json");
    });
  });

  describe("SSE streaming", () => {
    it("streams deltas and sends [DONE]", async () => {
      const session = createMockSession({ deltas: ["Hello", " World"] });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp())
        .post("/chat")
        .send({ message: "hi" })
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      expect(res.text).toContain('data: {"content":"Hello"}');
      expect(res.text).toContain('data: {"content":" World"}');
      expect(res.text).toContain("data: [DONE]");
    });

    it("includes history in prompt", async () => {
      const session = createMockSession({});
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      await request(createApp())
        .post("/chat")
        .send({
          message: "follow up",
          history: [
            { role: "user", content: "first" },
            { role: "assistant", content: "reply" },
          ],
        })
        .buffer(true);

      expect(session.send).toHaveBeenCalledWith({
        prompt: expect.stringContaining("user: first"),
      });
      expect(session.send).toHaveBeenCalledWith({
        prompt: expect.stringContaining("assistant: reply"),
      });
      expect(session.send).toHaveBeenCalledWith({
        prompt: expect.stringContaining("user: follow up"),
      });
    });

    it("accepts valid history with empty array", async () => {
      const session = createMockSession({ deltas: ["ok"] });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp())
        .post("/chat")
        .send({ message: "hi", history: [] })
        .buffer(true);

      expect(res.status).toBe(200);
      expect(res.text).toContain("data: [DONE]");
    });
  });

  describe("error handling", () => {
    it("sends SSE error event on session error", async () => {
      const session = createMockSession({ shouldError: true, errorMessage: "model failed" });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp())
        .post("/chat")
        .send({ message: "hi" })
        .buffer(true);

      expect(res.text).toContain("event: error");
      expect(res.text).toContain("Session error: model failed");
    });

    it("sends SSE error on createSession failure", async () => {
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockRejectedValue(new Error("auth failed")),
      });

      const res = await request(createApp())
        .post("/chat")
        .send({ message: "hi" })
        .buffer(true);

      expect(res.text).toContain("event: error");
      expect(res.text).toContain("auth failed");
    });
  });

  describe("session cleanup", () => {
    it("destroys session on success", async () => {
      const session = createMockSession({ deltas: ["test"] });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      await request(createApp())
        .post("/chat")
        .send({ message: "hi" })
        .buffer(true);

      expect(session.destroy).toHaveBeenCalledOnce();
    });

    it("destroys session on error", async () => {
      const session = createMockSession({ shouldError: true });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      await request(createApp())
        .post("/chat")
        .send({ message: "hi" })
        .buffer(true);

      expect(session.destroy).toHaveBeenCalledOnce();
    });
  });
});
