import { createHash, timingSafeEqual } from "node:crypto";

import { after, NextResponse } from "next/server";
import { z } from "zod";

import { dispatchMessagePush, isPushConfigured } from "@/features/notifications/server/dispatch";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  message_id: z.guid(),
  conversation_id: z.guid().optional(),
});

/** Constant-time comparison of equal-length digests, so timing reveals nothing. */
function secretsMatch(provided: string, expected: string) {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Called by Postgres (pg_net) after a message commits. Authenticates with a
 * shared secret, acknowledges immediately, and fans out after the response.
 */
export async function POST(request: Request) {
  const secret = process.env.PUSH_DISPATCH_SECRET;
  if (!secret || !isPushConfigured()) {
    return NextResponse.json({ error: "push_not_configured" }, { status: 503 });
  }
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const messageId = parsed.data.message_id;
  after(async () => {
    try {
      const result = await dispatchMessagePush(messageId);
      logger.info("push dispatched", { messageId, ...result });
    } catch (error) {
      logger.error("push dispatch failed", { messageId, error });
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
