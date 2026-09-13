import { z } from "zod";

import { TokenBucketLimiter } from "@/lib/async/token-bucket";
import { logger } from "@/lib/logger";

const MAX_BODY_BYTES = 12_000;

// 20 reports in a burst, then one every five seconds, per client address.
const limiter = new TokenBucketLimiter(20, 0.2);

const reportSchema = z.object({
  type: z.enum(["error", "unhandledrejection"]),
  message: z.string().max(1000),
  stack: z.string().max(6000).optional(),
  path: z.string().max(300).optional(),
  userAgent: z.string().max(400).optional(),
});

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/** Receives browser crash reports from instrumentation-client.ts into server logs. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!limiter.take(address).allowed) return new Response(null, { status: 429 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const parsed = reportSchema.safeParse(json);
  if (!parsed.success) return new Response(null, { status: 400 });

  logger.warn("browser error", { source: "client", ...parsed.data });
  return new Response(null, { status: 204 });
}
