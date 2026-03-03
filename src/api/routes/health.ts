import { Router } from "express";

const router = Router();
const startedAt = Date.now();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    telemetry: !!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  });
});

router.get("/config", (_req, res) => {
  const provider = process.env.MODEL_PROVIDER === "azure" ? "azure" : "github";
  const model = process.env.MODEL_NAME || "(default)";
  res.json({ model, provider });
});

export default router;
