import express from "express";
import { requireApiKey } from "./middleware/auth";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "linkrowth-api" });
  });

  // All /v1 routes require Bearer API key
  const v1 = express.Router();
  v1.use(requireApiKey);

  // Placeholder so auth can be verified before suggestion routes land
  v1.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/v1", v1);

  return app;
}
