import { Router } from "express";
import { getClient } from "../client.js";
import { getSessionOptions, enhanceModelError } from "../model-config.js";
import {
  createConversation, getConversation, deleteConversation, listConversations, addMessage,
} from "../store.js";
import {
  conversationsCreatedCounter, conversationsDeletedCounter, conversationMessagesCounter,
  chatRequestCounter, chatErrorCounter, chatDurationHistogram, log,
} from "../telemetry.js";

const router = Router();

// POST /conversations — create a new conversation
router.post("/conversations", async (req, res) => {
  const { title } = req.body as { title?: string };
  try {
    const conversation = await createConversation(title || "New conversation");
    conversationsCreatedCounter.add(1);
    log("info", "Conversation created", { conversationId: conversation.id, title: conversation.title });
    res.status(201).json(conversation);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "Failed to create conversation", { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /conversations — list conversations
router.get("/conversations", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  try {
    const result = await listConversations(limit, offset);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "Failed to list conversations", { error: message });
    res.status(500).json({ error: message });
  }
});

// GET /conversations/:id — get a conversation with history
router.get("/conversations/:id", async (req, res) => {
  try {
    const conversation = await getConversation(req.params.id);
    if (!conversation) {
      log("warn", "Conversation not found", { conversationId: req.params.id });
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json(conversation);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "Failed to get conversation", { conversationId: req.params.id, error: message });
    res.status(500).json({ error: message });
  }
});

// DELETE /conversations/:id — delete a conversation
router.delete("/conversations/:id", async (req, res) => {
  try {
    const deleted = await deleteConversation(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    conversationsDeletedCounter.add(1);
    log("info", "Conversation deleted", { conversationId: req.params.id });
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("error", "Failed to delete conversation", { conversationId: req.params.id, error: message });
    res.status(500).json({ error: message });
  }
});

// POST /conversations/:id/messages — add a message and get AI response
type SessionLike = {
  on(event: string, cb: (e: unknown) => void): () => void;
  send(msg: { prompt: string }): Promise<void>;
  destroy(): Promise<void>;
};

function waitForIdle(session: SessionLike, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubIdle();
      unsubError();
      reject(new Error(`Timeout after ${timeoutMs}ms waiting for response`));
    }, timeoutMs);

    const unsubIdle = session.on("session.idle", () => {
      clearTimeout(timer);
      unsubIdle();
      unsubError();
      resolve();
    });

    const unsubError = session.on("session.error", (event: unknown) => {
      clearTimeout(timer);
      unsubIdle();
      unsubError();
      const msg = (event as { data?: { message?: string } })?.data?.message ?? "Unknown session error";
      reject(new Error(`Session error: ${msg}`));
    });
  });
}

router.post("/conversations/:id/messages", async (req, res) => {
  const startTime = Date.now();
  const model = process.env.MODEL_NAME || "(default)";
  const provider = process.env.MODEL_PROVIDER || "github";
  const attrs = { model, provider };

  const { message } = req.body as { message?: string };
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "'message' must be a non-empty string" });
    return;
  }

  const conversationId = req.params.id;

  try {
    // Save user message
    const updated = await addMessage(conversationId, "user", message);
    if (!updated) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    conversationMessagesCounter.add(1, { role: "user" });
    chatRequestCounter.add(1, attrs);

    // Build prompt from full conversation history
    const prompt = updated.messages.map((m) => `${m.role}: ${m.content}`).join("\n");

    // SSE streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const copilot = await getClient();
    const options = await getSessionOptions({ streaming: true });
    const session = await copilot.createSession(options) as unknown as SessionLike;

    let assistantContent = "";
    const unsubDelta = session.on("assistant.message_delta", (event: unknown) => {
      if (res.socket?.destroyed) return;
      const delta = (event as { data?: { deltaContent?: string } })?.data?.deltaContent ?? "";
      if (delta) {
        assistantContent += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    });

    try {
      await session.send({ prompt });
      await waitForIdle(session);

      // Save assistant response to conversation
      if (assistantContent) {
        await addMessage(conversationId, "assistant", assistantContent);
        conversationMessagesCounter.add(1, { role: "assistant" });
      }

      const durationMs = Date.now() - startTime;
      chatDurationHistogram.record(durationMs, attrs);
      log("info", "Conversation message completed", { conversationId, durationMs, ...attrs });

      if (!res.socket?.destroyed) res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const enhanced = enhanceModelError(err);
      chatErrorCounter.add(1, attrs);
      chatDurationHistogram.record(durationMs, attrs);
      log("error", "Conversation message failed", { conversationId, durationMs, error: enhanced.message, ...attrs });

      if (!res.socket?.destroyed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: enhanced.message })}\n\n`);
      }
      res.end();
    } finally {
      unsubDelta();
      await session.destroy();
    }
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err);
    log("error", "Conversation message store error", { conversationId, error: message_ });
    if (!res.headersSent) {
      res.status(500).json({ error: message_ });
    } else {
      res.end();
    }
  }
});

export default router;
