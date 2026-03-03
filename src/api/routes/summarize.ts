import { Router } from "express";
import { getClient } from "../client.js";
import { getSessionOptions, enhanceModelError } from "../model-config.js";
import { summarizeRequestCounter, summarizeErrorCounter, summarizeDurationHistogram, log } from "../telemetry.js";

const router = Router();

interface SummarizeSession {
  sendAndWait(msg: { prompt: string }, timeout: number): Promise<{ data?: unknown } | undefined>;
  destroy(): Promise<void>;
}

router.post("/summarize", async (req, res) => {
  const startTime = Date.now();
  const model = process.env.MODEL_NAME || "(default)";
  const provider = process.env.MODEL_PROVIDER || "github";
  const attrs = { model, provider };

  const { text } = req.body as { text?: unknown };
  if (text === undefined || text === null) {
    res.status(400).json({ error: "Missing 'text' field" });
    return;
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "'text' must be a non-empty string" });
    return;
  }
  if (text.length > 50000) {
    res.status(413).json({ error: "'text' exceeds maximum length of 50000 characters" });
    return;
  }

  summarizeRequestCounter.add(1, attrs);
  log("info", "Summarize request started", { route: "/summarize", textLength: text.length, ...attrs });

  let session: SummarizeSession | null = null;
  try {
    const copilot = await getClient();
    const options = await getSessionOptions();
    session = await copilot.createSession(options) as unknown as SummarizeSession;

    const response = await session.sendAndWait(
      { prompt: `Summarize the following text in 2-3 concise sentences:\n\n${text}` },
      120_000,
    );

    const summary = (response?.data as { content?: string })?.content ?? "";
    const durationMs = Date.now() - startTime;
    summarizeDurationHistogram.record(durationMs, attrs);
    log("info", "Summarize request completed", { route: "/summarize", durationMs, ...attrs });

    res.json({ summary });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const enhanced = enhanceModelError(err);
    summarizeErrorCounter.add(1, attrs);
    summarizeDurationHistogram.record(durationMs, attrs);
    log("error", "Summarize request failed", { route: "/summarize", durationMs, error: enhanced.message, ...attrs });

    res.status(500).json({ error: enhanced.message });
  } finally {
    await session?.destroy();
  }
});

export default router;
