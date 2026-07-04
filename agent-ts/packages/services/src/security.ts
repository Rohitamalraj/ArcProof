/**
 * Basic hardening shared by every Fastify service (STATUS.md #5: "add basic
 * auth/rate-limiting before this ever runs anywhere reachable by someone
 * other than you"). Deliberately minimal -- a per-IP rate limit (always on)
 * and an optional shared-secret API key check on state-changing routes.
 *
 * API_KEY is optional and unset by default, same convention as every other
 * optional feature in this project (Circle Wallets, ETHERSCAN_API_KEY): if
 * you don't set it, local/demo use keeps working with zero config. Set it
 * once this runs anywhere another person could reach it.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "@arcproof/core";

const { API_KEY, FRONTEND_ORIGIN } = config;

/** Registers the per-IP rate limit on every route, and CORS if requested
 * (only the orchestrator needs CORS -- it's the one surface a browser
 * frontend calls directly; the other 4 services only ever get called
 * server-to-server).
 *
 * Must be awaited before any routes are defined on `app`: registering
 * without awaiting looked fine (no error, `app.hasDecorator("rateLimit")`
 * true) but the rate-limit hook silently never fired once these services
 * were booted the way cli/runDemo.ts boots all 5 concurrently via
 * `Promise.all(...map(app => app.listen(...)))` -- verified by reproducing
 * both ways in isolation. Awaiting registration here (and callers awaiting
 * this function) avoids that race entirely. */
export async function registerSecurity(app: FastifyInstance, opts: { cors?: boolean } = {}): Promise<void> {
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });

  if (opts.cors) {
    await app.register(cors, {
      origin: FRONTEND_ORIGIN || true, // true = reflect request origin; fine for a public testnet demo, set FRONTEND_ORIGIN to lock it down
    });
  }
}

/** Guards a state-changing route (e.g. POST /jobs) behind X-Api-Key when
 * API_KEY is configured. Returns true if the request may proceed. */
export function checkApiKey(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!API_KEY) return true; // no key configured -- auth disabled, local-dev default
  if (request.headers["x-api-key"] === API_KEY) return true;
  reply.code(401).send({ detail: "missing or invalid X-Api-Key header" });
  return false;
}
