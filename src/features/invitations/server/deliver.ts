import "server-only";

import { serverEnv } from "@/lib/env.server";
import { routes } from "@/lib/routes";
import { createSupabaseAdminClient, createSupabaseMailerClient } from "@/lib/supabase/admin";

import { classifyDeliveryFailure, type DeliveryIssue } from "../delivery-issues";
import { renderInviteEmail } from "./invite-email";

interface DeliveryInput {
  email: string;
  token: string;
  workspaceName: string;
  inviterName: string;
  origin: string;
}

export type DeliveryResult = { delivered: true } | { delivered: false; issue: DeliveryIssue; detail: string };

const failure = (detail: string, status?: number): DeliveryResult => ({
  delivered: false,
  issue: classifyDeliveryFailure(detail, status),
  detail,
});

const describe = (error: { code?: string; message: string }) => `${error.code ?? ""} ${error.message}`.trim();

/**
 * Resend when configured (branded template, any recipient on a verified
 * domain). Otherwise Supabase Auth: an invite email for new people, a sign-in
 * link that lands on the invitation for people who already have an account.
 */
export async function deliverInvitation(input: DeliveryInput): Promise<DeliveryResult> {
  const acceptPath = routes.invite(input.token);

  if (serverEnv.resendApiKey) {
    const viaResend = await sendWithResend(input, `${input.origin}${acceptPath}`);
    // An unverified sending domain shouldn't strand invites when Supabase can send them.
    const recoverable = !viaResend.delivered && (viaResend.issue === "rejected" || viaResend.issue === "not_configured");
    if (!recoverable || !serverEnv.hasServiceRoleKey) return viaResend;
  }

  if (!serverEnv.hasServiceRoleKey) {
    return {
      delivered: false,
      issue: "not_configured",
      detail: "Set RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY to send invitation emails.",
    };
  }

  const redirectTo = `${input.origin}${routes.authCallback}?next=${encodeURIComponent(acceptPath)}`;

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo,
      data: { invited_to_workspace: input.workspaceName },
    });
    if (!error) return { delivered: true };

    if (!/already (been )?registered|already exists/i.test(error.message)) {
      return failure(describe(error), error.status);
    }

    const mailer = createSupabaseMailerClient();
    const { error: linkError } = await mailer.auth.signInWithOtp({
      email: input.email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    return linkError ? failure(describe(linkError), linkError.status) : { delivered: true };
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Email delivery failed.");
  }
}

async function sendWithResend(input: DeliveryInput, acceptUrl: string): Promise<DeliveryResult> {
  const email = renderInviteEmail({
    workspaceName: input.workspaceName,
    inviterName: input.inviterName,
    acceptUrl,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverEnv.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: serverEnv.emailFrom,
        to: [input.email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [{ name: "category", value: "workspace_invite" }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { delivered: true };
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return failure(body?.message ?? `Resend responded ${response.status}`, response.status);
  } catch (error) {
    return failure(error instanceof Error ? error.message : "Resend request failed");
  }
}
