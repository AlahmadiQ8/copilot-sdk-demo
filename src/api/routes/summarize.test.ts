import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import request from "supertest";
import express from "express";

vi.mock("../client.js", () => ({
  getClient: vi.fn(),
}));

vi.mock("../model-config.js", () => ({
  getSessionOptions: vi.fn().mockResolvedValue({}),
  enhanceModelError: vi.fn((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
}));

import summarizeRoutes from "./summarize.js";
import { getClient } from "../client.js";

function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(summarizeRoutes);
  return app;
}

function createMockSession(response?: { data?: unknown }) {
  return {
    sendAndWait: vi.fn().mockResolvedValue(response ?? { data: { content: "Summary here." } }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe("POST /summarize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("rejects missing text", async () => {
      const res = await request(createApp()).post("/summarize").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Missing 'text'");
    });

    it("rejects empty text", async () => {
      const res = await request(createApp()).post("/summarize").send({ text: "   " });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("non-empty string");
    });

    it("rejects non-string text", async () => {
      const res = await request(createApp()).post("/summarize").send({ text: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("non-empty string");
    });

    it("rejects text exceeding 50000 characters", async () => {
      const res = await request(createApp()).post("/summarize").send({ text: "a".repeat(50001) });
      expect(res.status).toBe(413);
      expect(res.body.error).toContain("50000");
    });

    it("accepts text at exactly 50000 characters", async () => {
      const session = createMockSession();
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp()).post("/summarize").send({ text: "a".repeat(50000) });
      expect(res.status).toBe(200);
    });
  });

  describe("success path", () => {
    it("returns summary from session", async () => {
      const session = createMockSession({ data: { content: "This is a summary." } });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp()).post("/summarize").send({ text: "Some long text here." });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ summary: "This is a summary." });
    });

    it("returns empty string when response has no content", async () => {
      const session = createMockSession({ data: {} });
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp()).post("/summarize").send({ text: "text" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ summary: "" });
    });

    it("includes correct prompt", async () => {
      const session = createMockSession();
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      await request(createApp()).post("/summarize").send({ text: "My article." });

      expect(session.sendAndWait).toHaveBeenCalledWith(
        { prompt: expect.stringContaining("Summarize the following text") },
        120_000,
      );
      expect(session.sendAndWait).toHaveBeenCalledWith(
        { prompt: expect.stringContaining("My article.") },
        120_000,
      );
    });
  });

  describe("error handling", () => {
    it("returns 500 on sendAndWait failure", async () => {
      const session = {
        sendAndWait: vi.fn().mockRejectedValue(new Error("model error")),
        destroy: vi.fn().mockResolvedValue(undefined),
      };
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      const res = await request(createApp()).post("/summarize").send({ text: "text" });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("model error");
    });

    it("returns 500 on getClient failure", async () => {
      (getClient as Mock).mockRejectedValue(new Error("client init failed"));

      const res = await request(createApp()).post("/summarize").send({ text: "text" });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain("client init failed");
    });
  });

  describe("session cleanup", () => {
    it("destroys session on success", async () => {
      const session = createMockSession();
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      await request(createApp()).post("/summarize").send({ text: "text" });
      expect(session.destroy).toHaveBeenCalledOnce();
    });

    it("destroys session on error", async () => {
      const session = {
        sendAndWait: vi.fn().mockRejectedValue(new Error("boom")),
        destroy: vi.fn().mockResolvedValue(undefined),
      };
      (getClient as Mock).mockResolvedValue({
        createSession: vi.fn().mockResolvedValue(session),
      });

      await request(createApp()).post("/summarize").send({ text: "text" });
      expect(session.destroy).toHaveBeenCalledOnce();
    });
  });
});
