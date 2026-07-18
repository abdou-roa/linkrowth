import express from "express";
import { checkDatabase } from "./db/client";
import { requireApiKey } from "./middleware/auth";
import { suggestionsRouter } from "./routes/suggestions";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    const databaseUp = await checkDatabase();
    const body = {
      ok: databaseUp,
      service: "linkrowth-api",
      database: databaseUp ? "up" : "down",
    };
    res.status(databaseUp ? 200 : 503).json(body);
  });

  const v1 = express.Router();
  v1.use(requireApiKey);

  v1.get("/ping", (_req, res) => {
    res.json({ ok: true });
  });

  v1.use("/suggestions", suggestionsRouter());

  app.use("/v1", v1);

  return app;
}
