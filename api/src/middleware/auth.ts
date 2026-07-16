import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Require `Authorization: Bearer <API_KEY>`.
 * Applied to /v1/*; /health stays public.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!env.apiKey) {
    res.status(503).json({
      error: "auth_not_configured",
      message: "API_KEY is not set on the server",
    });
    return;
  }

  const header = req.get("authorization");
  if (!header) {
    res.status(401).json({
      error: "unauthorized",
      message: "Missing Authorization header",
    });
    return;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    res.status(401).json({
      error: "unauthorized",
      message: "Expected Authorization: Bearer <token>",
    });
    return;
  }

  if (!safeEqual(token, env.apiKey)) {
    res.status(401).json({
      error: "unauthorized",
      message: "Invalid API key",
    });
    return;
  }

  next();
}
