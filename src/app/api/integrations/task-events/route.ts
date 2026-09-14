import { after, NextResponse } from "next/server";
import { z } from "zod";

import { TASK_EVENTS } from "@/features/integrations/lib/task-events";
import { deliverTaskEvent } from "@/features/integrations/server/task-webhooks";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const bodySchema = z.object({ taskId: z.guid(), event: z.enum(TASK_EVENTS) });

const log = logger.child({ module: "api-task-events" });

/** The same change reported twice (a retry, two tabs) is sent once. */
const SENT_WINDOW_MS = 10 * 60_000;
const sent = new Map<string, number>();
/** Per person, per server instance: plenty for real editing, not for a loop. */
const PER_MINUTE = 120;
const calls = new Map<string, { count: number; since: number }>();

function alreadySent(key: string, now: number) {
  for (const [entry, at] of sent) if (now - at > SENT_WINDOW_MS) sent.delete(entry);
  if (sent.has(key)) return true;
  sent.set(key, now);
  return false;
}

function overLimit(userId: string, now: number) {
  const window = calls.get(userId);
  if (!window || now - window.since > 60_000) {
    calls.set(userId, { count: 1, since: now });
    return false;
  }
  window.count += 1;
  return window.count > PER_MINUTE;
}

/**
 * Someone changed a task in the browser; apps the workspace connected hear
 * about it. The task is read back as that person, so only a task they can see,
 * in the state it's really in, is ever sent.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "That request wasn't valid." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Your session ended. Sign in again." }, { status: 401 });
  if (!serverEnv.hasServiceRoleKey) return new NextResponse(null, { status: 204 });

  const userId = auth.user.id;
  const now = Date.now();
  if (overLimit(userId, now)) return NextResponse.json({ error: "Too many task updates. Give it a moment." }, { status: 429 });

  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, assignee_id, agent_id, version")
    .eq("id", parsed.data.taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const { event } = parsed.data;
  const consistent =
    (event !== "task.completed" || task.status === "done") && (event !== "task.assigned" || Boolean(task.assignee_id || task.agent_id));
  if (!consistent || alreadySent(`${task.id}:${task.version}:${event}`, now)) {
    return NextResponse.json({ sent: false }, { status: 202 });
  }

  const admin = createSupabaseAdminClient();
  after(async () => {
    try {
      const { data: profile } = await admin.from("profiles").select("display_name, full_name, email").eq("id", userId).maybeSingle();
      const actorName = profile ? profile.display_name || profile.full_name || profile.email.split("@")[0] : "Someone";
      await deliverTaskEvent(admin, { event, taskId: task.id, actorName });
    } catch (error) {
      log.error("task event delivery failed", { taskId: task.id, event, error });
    }
  });
  return NextResponse.json({ sent: true }, { status: 202 });
}
