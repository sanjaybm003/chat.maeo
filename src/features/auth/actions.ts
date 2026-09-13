"use server";

import { redirect } from "next/navigation";

import { fail, ok, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";
import { getAppOrigin } from "@/lib/request";
import { routes, safeNextPath } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  emailLinkSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type EmailLinkInput,
  type SignInInput,
  type SignUpInput,
  type UpdatePasswordInput,
} from "./schemas";

type Redirect = { redirectTo: string };

async function callbackUrl(next: string) {
  const origin = await getAppOrigin();
  return `${origin}${routes.authCallback}?next=${encodeURIComponent(next)}`;
}

export async function signInWithPassword(input: SignInInput): Promise<ActionResult<Redirect>> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return fail(getErrorMessage(error));

  return ok({ redirectTo: safeNextPath(parsed.data.next) });
}

export async function signUp(
  input: SignUpInput,
): Promise<ActionResult<Redirect & { needsConfirmation: boolean }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const next = safeNextPath(parsed.data.next, routes.onboarding.profile);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: await callbackUrl(next),
      data: { password_set: true },
    },
  });
  if (error) return fail(getErrorMessage(error));

  // Supabase hides existing accounts by returning a user without identities.
  if (data.user && data.user.identities?.length === 0) {
    return fail("An account with this email already exists. Try signing in.", {
      email: "Already registered.",
    });
  }

  if (data.session) {
    return ok({ redirectTo: next, needsConfirmation: false });
  }
  return ok({ redirectTo: routes.checkEmail, needsConfirmation: true });
}

export async function sendSignInLink(input: EmailLinkInput): Promise<ActionResult> {
  const parsed = emailLinkSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: await callbackUrl(safeNextPath(parsed.data.next)),
    },
  });

  // Unknown addresses look identical to known ones, so accounts can't be probed.
  if (error && !/signups not allowed|user not found/i.test(error.message)) {
    return fail(getErrorMessage(error));
  }
  return ok();
}

export async function startGoogleSignIn(nextPath?: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: await callbackUrl(safeNextPath(nextPath)),
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) return fail(getErrorMessage(error, "Google sign-in isn't available right now."));
  return ok({ url: data.url });
}

export async function requestPasswordReset(input: { email: string }): Promise<ActionResult> {
  const parsed = emailLinkSchema.pick({ email: true }).safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: await callbackUrl(routes.resetPassword),
  });
  if (error && /rate limit|security purposes/i.test(error.message)) {
    return fail(getErrorMessage(error));
  }
  return ok();
}

export async function resendConfirmation(input: { email: string }): Promise<ActionResult> {
  const parsed = emailLinkSchema.pick({ email: true }).safeParse(input);
  if (!parsed.success) return fail("That email address isn't valid.");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: await callbackUrl(routes.onboarding.profile) },
  });
  if (error) return fail(getErrorMessage(error));
  return ok();
}

export async function updatePassword(input: UpdatePasswordInput): Promise<ActionResult<Redirect>> {
  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return fail("Your reset link expired. Request a new one.");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
    data: { password_set: true },
  });
  if (error) return fail(getErrorMessage(error), /different/i.test(error.message) ? { password: getErrorMessage(error) } : undefined);

  return ok({ redirectTo: routes.home });
}

/** Safe to pass straight to <form action>. */
export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(routes.login);
}

/** Ends every session on every device, including this one. */
export async function signOutEverywhere() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect(`${routes.login}?error=session`);
}
