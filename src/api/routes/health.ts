import { Router } from "express";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/config", (_req, res) => {
  const provider = process.env.MODEL_PROVIDER === "azure" ? "azure" : "github";
  const model = process.env.MODEL_NAME || "(default)";
  res.json({ model, provider });
});

export default router;
