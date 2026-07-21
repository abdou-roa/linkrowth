import { Router } from "express";
import { createSuggestionJob, getSuggestionJob } from "../../db/suggestions";
import { processSuggestionJob } from "../../services/processSuggestionJob";
import {
  parseCreateSuggestionRequest,
  parseJobId,
  ValidationError,
} from "./validate";

export function suggestionsRouter(): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    try {
      const { feedPost, triage, notes } = parseCreateSuggestionRequest(req.body);
      const job = await createSuggestionJob(feedPost, triage, notes);

      if (job.status === "queued") {
        void processSuggestionJob(job.jobId, feedPost).catch((err) => {
          console.error("[api] suggestion job processing failed", job.jobId, err);
        });
      }

      res.status(202).json(job);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: "validation_error", message: err.message });
        return;
      }
      console.error("[api] POST /v1/suggestions failed", err);
      res.status(500).json({ error: "internal_error", message: "Failed to create suggestion job" });
    }
  });

  router.get("/:jobId", async (req, res) => {
    try {
      const rawId = req.params.jobId;
      const jobId = parseJobId(typeof rawId === "string" ? rawId : rawId[0] ?? "");
      const job = await getSuggestionJob(jobId);
      if (!job) {
        res.status(404).json({ error: "not_found", message: "Suggestion job not found" });
        return;
      }
      res.status(200).json(job);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: "validation_error", message: err.message });
        return;
      }
      console.error("[api] GET /v1/suggestions/:jobId failed", err);
      res.status(500).json({ error: "internal_error", message: "Failed to load suggestion job" });
    }
  });

  return router;
}
