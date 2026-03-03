import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// Mock the store module
vi.mock("../store.js", () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  listConversations: vi.fn(),
  addMessage: vi.fn(),
}));

// Mock the client module
vi.mock("../client.js", () => ({
  getClient: vi.fn(),
}));

// Mock the model-config module
vi.mock("../model-config.js", () => ({
  getSessionOptions: vi.fn().mockResolvedValue({ streaming: true }),
  enhanceModelError: vi.fn((err: unknown) => err instanceof Error ? err : new Error(String(err))),
}));

import conversationRoutes from "./conversations.js";
import { createConversation, getConversation, deleteConversation, listConversations, addMessage } from "../store.js";

const mockedCreate = vi.mocked(createConversation);
const mockedGet = vi.mocked(getConversation);
const mockedDelete = vi.mocked(deleteConversation);
const mockedList = vi.mocked(listConversations);
const mockedAddMessage = vi.mocked(addMessage);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(conversationRoutes);
  return app;
}

describe("POST /conversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a conversation with title", async () => {
    const conv = { id: "abc", conversationId: "abc", title: "Test", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    mockedCreate.mockResolvedValue(conv);

    const res = await request(createApp())
      .post("/conversations")
      .send({ title: "Test" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("abc");
    expect(mockedCreate).toHaveBeenCalledWith("Test");
  });

  it("creates with default title when none provided", async () => {
    const conv = { id: "abc", conversationId: "abc", title: "New conversation", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    mockedCreate.mockResolvedValue(conv);

    const res = await request(createApp())
      .post("/conversations")
      .send({});

    expect(res.status).toBe(201);
    expect(mockedCreate).toHaveBeenCalledWith("New conversation");
  });

  it("returns 500 on store error", async () => {
    mockedCreate.mockRejectedValue(new Error("Cosmos unavailable"));

    const res = await request(createApp())
      .post("/conversations")
      .send({ title: "Test" });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain("Cosmos unavailable");
  });
});

describe("GET /conversations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists conversations with defaults", async () => {
    mockedList.mockResolvedValue({ conversations: [], count: 0 });

    const res = await request(createApp()).get("/conversations");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversations: [], count: 0 });
    expect(mockedList).toHaveBeenCalledWith(20, 0);
  });

  it("respects limit and offset params", async () => {
    mockedList.mockResolvedValue({ conversations: [], count: 0 });

    await request(createApp()).get("/conversations?limit=5&offset=10");

    expect(mockedList).toHaveBeenCalledWith(5, 10);
  });

  it("caps limit at 100", async () => {
    mockedList.mockResolvedValue({ conversations: [], count: 0 });

    await request(createApp()).get("/conversations?limit=999");

    expect(mockedList).toHaveBeenCalledWith(100, 0);
  });
});

describe("GET /conversations/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns conversation when found", async () => {
    const conv = { id: "abc", conversationId: "abc", title: "Test", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    mockedGet.mockResolvedValue(conv);

    const res = await request(createApp()).get("/conversations/abc");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("abc");
  });

  it("returns 404 when not found", async () => {
    mockedGet.mockResolvedValue(null);

    const res = await request(createApp()).get("/conversations/missing");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Conversation not found");
  });
});

describe("DELETE /conversations/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes and returns 204", async () => {
    mockedDelete.mockResolvedValue(true);

    const res = await request(createApp()).delete("/conversations/abc");

    expect(res.status).toBe(204);
  });

  it("returns 404 when not found", async () => {
    mockedDelete.mockResolvedValue(false);

    const res = await request(createApp()).delete("/conversations/missing");

    expect(res.status).toBe(404);
  });
});

describe("POST /conversations/:id/messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty message", async () => {
    const res = await request(createApp())
      .post("/conversations/abc/messages")
      .send({ message: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("non-empty string");
  });

  it("rejects missing message", async () => {
    const res = await request(createApp())
      .post("/conversations/abc/messages")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 when conversation not found", async () => {
    mockedAddMessage.mockResolvedValue(null);

    const res = await request(createApp())
      .post("/conversations/missing/messages")
      .send({ message: "Hello" });

    expect(res.status).toBe(404);
  });
});
