import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";

const DATABASE_TIMEOUT_MS = 3000;

/**
 * Liveness and readiness for load balancers and uptime monitors.
 * 200 when the database answers, 503 otherwise. Never exposes error details.
 */
export async function GET() {
  const started = Date.now();
  let databaseOk = false;

  try {
    const client = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.rpc("health_check").abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
    databaseOk = !error;
    if (error) logger.warn("health check: database error", { error });
  } catch (error) {
    logger.warn("health check: database unreachable", { error });
  }

  const body = {
    status: databaseOk ? "ok" : "degraded",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database: { ok: databaseOk, latencyMs: Date.now() - started } },
  };

  return NextResponse.json(body, {
    status: databaseOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
