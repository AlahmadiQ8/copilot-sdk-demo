import { Router } from "express";
import { getClient } from "../client.js";
import { getSessionOptions, enhanceModelError } from "../model-config.js";

const router = Router();

type SessionLike = {
  on(event: string, cb: (e: unknown) => void): () => void;
  send(msg: { prompt: string }): Promise<void>;
  destroy(): Promise<void>;
};

/** Wait for the session to become idle or error, with a configurable timeout. */
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

const ALLOWED_ROLES = new Set(["user", "assistant"]);

function isValidHistoryItem(item: unknown): item is { role: string; content: string } {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof (item as Record<string, unknown>).role === "string" &&
    ALLOWED_ROLES.has((item as Record<string, unknown>).role as string) &&
    typeof (item as Record<string, unknown>).content === "string"
  );
}

router.post("/chat", async (req, res) => {
  const { message, history } = req.body as {
    message?: unknown;
    history?: unknown;
  };

  if (message === undefined || message === null) {
    res.status(400).json({ error: "Missing 'message' field" });
    return;
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "'message' must be a non-empty string" });
    return;
  }
  if (history !== undefined && !Array.isArray(history)) {
    res.status(400).json({ error: "'history' must be an array" });
    return;
  }
  if (Array.isArray(history) && !history.every(isValidHistoryItem)) {
    res.status(400).json({ error: "Each history item must have 'role' ('user'|'assistant') and 'content' strings" });
    return;
  }

  // Build prompt before flushing SSE headers so validation errors return JSON 400
  const prompt = Array.isArray(history) && history.length > 0
    ? [...history.map((h) => `${h.role}: ${h.content}`), `user: ${message}`].join("\n")
    : message;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let session: SessionLike | null = null;
  let unsubDelta: (() => void) | null = null;

  try {
    const copilot = await getClient();
    const options = await getSessionOptions({ streaming: true });
    session = await copilot.createSession(options) as unknown as SessionLike;

    unsubDelta = session.on("assistant.message_delta", (event: unknown) => {
      if (res.socket?.destroyed) return;
      const delta = (event as { data?: { deltaContent?: string } })?.data?.deltaContent ?? "";
      if (delta) {
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    });

    await session.send({ prompt });
    await waitForIdle(session);

    if (!res.socket?.destroyed) {
      res.write(`data: [DONE]\n\n`);
    }
    res.end();
  } catch (err) {
    const enhanced = enhanceModelError(err);
    if (!res.socket?.destroyed) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: enhanced.message })}\n\n`);
    }
    res.end();
  } finally {
    unsubDelta?.();
    await session?.destroy();
  }
});

export default router;
