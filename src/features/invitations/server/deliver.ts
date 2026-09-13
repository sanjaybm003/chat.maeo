import "server-only";

import { serverEnv } from "@/lib/env.server";
import { routes } from "@/lib/routes";
import { createSupabaseAdminClient, createSupabaseMailerClient } from "@/lib/supabase/admin";

import { renderInviteEmail } from "./invite-email";

interface DeliveryInput {
  email: string;
  token: string;
  workspaceName: string;
  inviterName: string;
  origin: string;
}

export type DeliveryResult = { delivered: true } | { delivered: false; reason: string };

/**
 * Resend when configured (branded template, works for everyone). Otherwise
 * Supabase Auth: an invite email for new people, a sign-in link that lands on
 * the invitation for people who already have an account.
 */
export async function deliverInvitation(input: DeliveryInput): Promise<DeliveryResult> {
  const acceptPath = routes.invite(input.token);

  if (serverEnv.resendApiKey) {
    return sendWithResend(input, `${input.origin}${acceptPath}`);
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
      return { delivered: false, reason: error.message };
    }

    const mailer = createSupabaseMailerClient();
    const { error: linkError } = await mailer.auth.signInWithOtp({
      email: input.email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    return linkError ? { delivered: false, reason: linkError.message } : { delivered: true };
  } catch (error) {
    return { delivered: false, reason: error instanceof Error ? error.message : "Email delivery is not configured." };
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
    return { delivered: false, reason: body?.message ?? `Resend responded ${response.status}` };
  } catch (error) {
    return { delivered: false, reason: error instanceof Error ? error.message : "Resend request failed" };
  }
}
