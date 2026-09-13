"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import { LAST_WORKSPACE_COOKIE } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { getAppOrigin } from "@/lib/request";
import { routes } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { deliverInvitation } from "./server/deliver";
import type { InviteReport } from "./types";

const inviteSchema = z.object({
  workspaceId: z.uuid(),
  emails: z.array(z.string().trim().toLowerCase().max(320)).min(1, "Add at least one email address.").max(25, "Invite up to 25 people at a time."),
  role: z.enum(["member", "admin"]).default("member"),
});

const tokenSchema = z.string().regex(/^[a-f0-9]{48}$/, "This invitation link is not valid.");

export async function inviteToWorkspace(input: z.input<typeof inviteSchema>): Promise<ActionResult<InviteReport>> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the email addresses.");

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");

  const { data: rows, error } = await supabase.rpc("invite_workspace_members", {
    p_workspace_id: parsed.data.workspaceId,
    p_emails: parsed.data.emails,
    p_role: parsed.data.role,
  });
  if (error) return fail(getErrorMessage(error));

  const [{ data: workspace }, { data: inviter }, origin] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", parsed.data.workspaceId).single(),
    supabase.from("profiles").select("full_name, display_name, email").eq("id", auth.user.id).single(),
    getAppOrigin(),
  ]);

  const workspaceName = workspace?.name ?? "your team";
  const inviterName = inviter?.full_name || inviter?.display_name || inviter?.email || "A teammate";
  const report: InviteReport = { sent: [], alreadyMembers: [], invalid: [], undelivered: [] };

  await Promise.all(
    (rows ?? []).map(async (row) => {
      if (row.outcome === "already_member") return void report.alreadyMembers.push(row.invited_email);
      if (row.outcome === "invalid" || !row.invite_token) return void report.invalid.push(row.invited_email);

      const delivery = await deliverInvitation({
        email: row.invited_email,
        token: row.invite_token,
        workspaceName,
        inviterName,
        origin,
      });
      if (delivery.delivered) {
        report.sent.push(row.invited_email);
      } else {
        console.error("[invitations] delivery failed", { email: row.invited_email, reason: delivery.reason });
        report.undelivered.push({ email: row.invited_email, link: `${origin}${routes.invite(row.invite_token)}` });
      }
    }),
  );

  return ok(report);
}

export async function acceptInvitation(token: string): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Sign in to accept this invitation.");

  const { data: slug, error } = await supabase.rpc("accept_invitation", { p_token: parsed.data });
  if (error) return fail(getErrorMessage(error));

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, onboarded_at")
    .eq("id", auth.user.id)
    .single();

  (await cookies()).set(LAST_WORKSPACE_COOKIE, slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });

  if (!profile?.full_name) {
    return ok({ redirectTo: `${routes.onboarding.profile}?next=${encodeURIComponent(routes.workspace(slug))}` });
  }
  if (!profile.onboarded_at) {
    await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", auth.user.id);
  }
  return ok({ redirectTo: routes.workspace(slug) });
}

export async function declineInvitation(token: string): Promise<ActionResult> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("decline_invitation", { p_token: parsed.data });
  if (error) return fail(getErrorMessage(error));
  return ok();
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(invitationId);
  if (!parsed.success) return fail("Invitation not found.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: parsed.data });
  if (error) return fail(getErrorMessage(error));
  return ok();
}
