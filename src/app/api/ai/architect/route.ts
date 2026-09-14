import { NextResponse } from "next/server";
import { z } from "zod";

import { architectOutputSchema, normalizeDraft } from "@/features/ai/agent-spec";
import { draftAgentBlueprint } from "@/features/ai/server/architect";
import { AgentRunError } from "@/features/ai/server/errors";
import { ProviderError } from "@/features/ai/server/providers";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SPECIALTIES } from "@/types/domain";

export const maxDuration = 60;

const bodySchema = z.object({
  workspaceId: z.guid(),
  prompt: z.string().trim().min(6, "Say a little more about the agent.").max(2000, "Keep the description under 2,000 characters."),
  specialty: z.enum(SPECIALTIES).nullish(),
  current: architectOutputSchema.nullish(),
});

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

/** Drafts an agent from a plain-language description. Nothing is saved until the person confirms. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return reply(400, { error: parsed.error.issues[0]?.message ?? "That request wasn't valid.", code: "invalid" });
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return reply(401, { error: "Your session ended. Sign in again.", code: "unauthorized" });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return reply(404, { error: "Workspace not found.", code: "not_found" });

  if (!serverEnv.hasServiceRoleKey) {
    logger.error("AI is not configured: SUPABASE_SERVICE_ROLE_KEY is missing");
    return reply(503, { error: "AI agents aren’t available right now. Try again soon.", code: "unavailable" });
  }

  try {
    const result = await draftAgentBlueprint({
      userId: user.id,
      workspaceId: parsed.data.workspaceId,
      prompt: parsed.data.prompt,
      specialty: parsed.data.specialty ?? null,
      current: parsed.data.current ? normalizeDraft(parsed.data.current) : null,
    });
    return reply(200, { ...result });
  } catch (error) {
    if (error instanceof AgentRunError) {
      const status = error.kind === "out_of_credits" ? 402 : error.kind === "unavailable" ? 503 : 422;
      return reply(status, { error: error.message, code: error.kind });
    }
    if (error instanceof ProviderError) {
      logger.warn("architect provider error", { kind: error.kind, provider: error.provider });
      if (error.kind === "unavailable" || error.kind === "auth" || error.kind === "not_configured") {
        return reply(503, { error: "AI isn’t available right now. Try again soon.", code: "unavailable" });
      }
      const status = error.kind === "rate_limited" ? 429 : error.kind === "refused" ? 422 : 502;
      const message =
        error.kind === "refused" ? "That description couldn’t be turned into an agent." : "AI is busy right now. Try again in a moment.";
      return reply(status, { error: message, code: error.kind });
    }
    logger.error("architect route failed", { error });
    return reply(500, { error: "Couldn’t draft that agent. Try again.", code: "failed" });
  }
}
