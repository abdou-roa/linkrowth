import { Router } from "express";
import { createSuggestionJob, getSuggestionJob } from "@linkrowth/db";
import {
  claimClarificationResume,
  continueSuggestionJobAfterClarification,
  processSuggestionJob,
} from "../../services/processSuggestionJob";
import {
  parseClarificationAnswer,
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

  router.patch("/:jobId/clarification", async (req, res) => {
    try {
      const rawId = req.params.jobId;
      const jobId = parseJobId(typeof rawId === "string" ? rawId : rawId[0] ?? "");
      const { answer } = parseClarificationAnswer(req.body);

      const claimed = await claimClarificationResume(jobId, answer);
      if (!claimed.ok) {
        const existing = await getSuggestionJob(jobId);
        if (!existing) {
          res.status(404).json({ error: "not_found", message: "Suggestion job not found" });
          return;
        }
        res.status(409).json({
          error: "conflict",
          message: claimed.error,
        });
        return;
      }

      void continueSuggestionJobAfterClarification(claimed.resumed, answer).catch(
        (err) => {
          console.error("[api] resume suggestion job failed", jobId, err);
        }
      );

      res.status(202).json({
        jobId,
        postId: claimed.resumed.post.id,
        status: "running",
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: "validation_error", message: err.message });
        return;
      }
      console.error("[api] PATCH /v1/suggestions/:jobId/clarification failed", err);
      res.status(500).json({
        error: "internal_error",
        message: "Failed to resume suggestion job",
      });
    }
  });

  return router;
}
