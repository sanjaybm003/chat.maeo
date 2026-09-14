import { NextResponse } from "next/server";
import { z } from "zod";

import { parseIncoming } from "@/features/integrations/lib/incoming";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const log = logger.child({ module: "api-hooks" });

const MAX_BODY_BYTES = 64_000;
const TOKEN = /^[0-9a-f]{48}$/;

const reply = (status: number, body: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * An incoming webhook: any app posts here and the text appears in the chat the
 * link was made for. The link itself is the credential, so a wrong id and a
 * wrong secret look the same from outside.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!z.guid().safeParse(id).success || !TOKEN.test(token)) return reply(404, { ok: false, error: "That webhook doesn't exist." });
  if (!serverEnv.hasServiceRoleKey) return reply(503, { ok: false, error: "Webhooks aren't available on this server right now." });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: "That's too much. Send up to 4,000 characters of text." });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: "That's too much. Send up to 4,000 characters of text." });

  const post = parseIncoming(raw, request.headers.get("content-type"));
  if (!post) return reply(400, { ok: false, error: 'Send JSON like {"text": "Deploy finished"}, or plain text.' });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("post_webhook_message", {
    p_webhook_id: id,
    p_token: token,
    p_body: post.text,
    p_name: post.name,
  });
  if (error) {
    switch (error.code) {
      case "P0002":
        return reply(404, { ok: false, error: "That webhook doesn't exist." });
      case "22023":
        return reply(400, { ok: false, error: error.message });
      case "P0429": {
        const retryAfter = /retry_after=(\d+)/.exec(error.hint ?? "")?.[1] ?? "5";
        return reply(429, { ok: false, error: "Too many messages. Slow down and try again." }, { "Retry-After": retryAfter });
      }
      default:
        log.error("webhook post failed", { webhookId: id, error });
        return reply(500, { ok: false, error: "The message couldn't be posted. Try again." });
    }
  }
  return reply(201, { ok: true, message_id: data });
}
