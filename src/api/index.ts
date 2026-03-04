import "./telemetry.js"; // Must be first — patches HTTP/Express for OpenTelemetry
import express from "express";
import cors from "cors";
import healthRoutes from "./routes/health.js";
import summarizeRoutes from "./routes/summarize.js";
import chatRoutes from "./routes/chat.js";
import conversationRoutes from "./routes/conversations.js";

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS?.split(",") ?? [])
  .map((o) => o.trim())
  .filter(Boolean);
if (process.env.NODE_ENV !== "production") {
  allowedOrigins.push("http://localhost:5173");
}
if (allowedOrigins.length === 0) {
  console.warn("⚠ No CORS origins configured. All cross-origin requests will be rejected.");
}
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "1mb" }));
app.use(healthRoutes);
app.use(summarizeRoutes);
app.use(chatRoutes);
app.use(conversationRoutes);

if (!process.env.COPILOT_GITHUB_TOKEN) {
  console.warn("⚠ COPILOT_GITHUB_TOKEN is not set. AI endpoints will not work.");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Copilot SDK service listening on port ${PORT}`);
});
