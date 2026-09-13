import "server-only";

import webpush, { type PushSubscription } from "web-push";

import { mapWithConcurrency } from "@/lib/async/pool";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { routes } from "@/lib/routes";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const log = logger.child({ module: "push" });
const SEND_CONCURRENCY = 8;

let vapidConfigured = false;

export function isPushConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.PUSH_DISPATCH_SECRET,
  );
}

function configureVapid() {
  if (vapidConfigured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("VAPID keys are not configured.");
  const subject = process.env.VAPID_SUBJECT || `mailto:notifications@${new URL(env.siteUrl).hostname}`;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

type SenderProfile = { display_name: string | null; full_name: string | null; email: string } | null;

function senderName(profile: SenderProfile) {
  return profile?.display_name || profile?.full_name || profile?.email.split("@")[0] || "Someone";
}

function summarize(body: string, attachments: unknown) {
  const text = body.replace(/\s+/g, " ").trim();
  if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  const count = Array.isArray(attachments) ? attachments.length : 0;
  return count === 1 ? "Sent an attachment" : `Sent ${count} attachments`;
}

export interface DispatchResult {
  recipients: number;
  delivered: number;
  removed: number;
  skipped?: "not-deliverable" | "no-recipients" | "no-subscriptions";
}

/**
 * Fans a new message out as web push to every participant except the sender
 * and anyone who muted the chat. Expired subscriptions (404/410) are pruned.
 * Notifications collapse per conversation via the push `topic`.
 */
export async function dispatchMessagePush(messageId: string): Promise<DispatchResult> {
  configureVapid();
  const admin = createSupabaseAdminClient();

  const { data: message, error: messageError } = await admin
    .from("messages")
    .select("id, conversation_id, sender_id, kind, body, attachments, deleted_at, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (messageError) throw messageError;
  if (!message || message.kind !== "text" || message.deleted_at) {
    return { recipients: 0, delivered: 0, removed: 0, skipped: "not-deliverable" };
  }

  const [conversationResult, participantsResult, senderResult] = await Promise.all([
    admin.from("conversations").select("id, kind, name, workspace_id").eq("id", message.conversation_id).single(),
    admin.from("conversation_participants").select("user_id, muted").eq("conversation_id", message.conversation_id),
    admin
      .from("profiles")
      .select("display_name, full_name, email")
      .eq("id", message.sender_id ?? "00000000-0000-0000-0000-000000000000")
      .maybeSingle(),
  ]);
  if (conversationResult.error) throw conversationResult.error;
  if (participantsResult.error) throw participantsResult.error;

  const conversation = conversationResult.data;
  const recipients = (participantsResult.data ?? [])
    .filter((participant) => participant.user_id !== message.sender_id && !participant.muted)
    .map((participant) => participant.user_id);
  if (recipients.length === 0) return { recipients: 0, delivered: 0, removed: 0, skipped: "no-recipients" };

  const [subscriptionsResult, workspaceResult] = await Promise.all([
    admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipients),
    admin.from("workspaces").select("slug").eq("id", conversation.workspace_id).single(),
  ]);
  if (subscriptionsResult.error) throw subscriptionsResult.error;

  const subscriptions = subscriptionsResult.data ?? [];
  if (subscriptions.length === 0) {
    return { recipients: recipients.length, delivered: 0, removed: 0, skipped: "no-subscriptions" };
  }

  const from = senderName(senderResult.data);
  const text = summarize(message.body, message.attachments);
  const isGroup = conversation.kind === "group";
  const payload = JSON.stringify({
    title: isGroup ? (conversation.name ?? "Group chat") : from,
    body: isGroup ? `${from}: ${text}` : text,
    url: workspaceResult.data ? routes.conversation(workspaceResult.data.slug, conversation.id) : routes.home,
    tag: conversation.id,
    timestamp: Date.parse(message.created_at) || Date.now(),
  });

  const stale: string[] = [];
  let delivered = 0;

  await mapWithConcurrency(subscriptions, SEND_CONCURRENCY, async (subscription) => {
    const target: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    try {
      await webpush.sendNotification(target, payload, {
        TTL: 60 * 60,
        urgency: "high",
        topic: conversation.id.replace(/-/g, "").slice(0, 32),
      });
      delivered += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) stale.push(subscription.id);
      else log.warn("push delivery failed", { statusCode, error });
    }
  });

  if (stale.length > 0) {
    const { error } = await admin.from("push_subscriptions").delete().in("id", stale);
    if (error) log.warn("could not prune expired push subscriptions", { error });
  }

  return { recipients: recipients.length, delivered, removed: stale.length };
}
