"use server";

import { cookies } from "next/headers";

import { fail, ok, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { LAST_WORKSPACE_COOKIE } from "@/lib/constants";
import { getErrorMessage } from "@/lib/errors";
import { routes, safeNextPath } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { needsPassword } from "@/server/session";

import { createWorkspaceSchema, profileStepSchema, type CreateWorkspaceInput, type ProfileStepInput } from "./schemas";

type Redirect = { redirectTo: string };

export async function saveOnboardingProfile(input: ProfileStepInput): Promise<ActionResult<Redirect>> {
  const parsed = profileStepSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return fail("Your session ended. Sign in again.");

  const passwordRequired = needsPassword(user);
  if (passwordRequired && !parsed.data.password) {
    return fail("Choose a password so you can sign in next time.", { password: "Choose a password." });
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      display_name: parsed.data.displayName,
      title: parsed.data.title,
      color: parsed.data.color,
    })
    .eq("id", user.id);
  if (error) return fail(getErrorMessage(error));

  if (passwordRequired && parsed.data.password) {
    const { error: passwordError } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: { password_set: true },
    });
    if (passwordError) return fail(getErrorMessage(passwordError), { password: getErrorMessage(passwordError) });
  }

  if (parsed.data.next) {
    return ok({ redirectTo: safeNextPath(parsed.data.next, routes.onboarding.workspace) });
  }

  const { data: workspaces } = await supabase.rpc("my_workspaces");
  return ok({ redirectTo: workspaces?.length ? routes.home : routes.onboarding.workspace });
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<ActionResult<Redirect & { slug: string }>> {
  const parsed = createWorkspaceSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues));
  }

  const supabase = await createSupabaseServerClient();
  const { data: slug, error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_team_size: parsed.data.teamSize,
    p_use_case: parsed.data.useCase,
  });

  if (error) {
    if (error.code === "23505") {
      return fail("That workspace URL is already taken.", { slug: "Taken. Try another." });
    }
    return fail(getErrorMessage(error));
  }

  await rememberWorkspace(slug);
  return ok({ slug, redirectTo: routes.onboarding.invite(slug) });
}

export async function completeOnboarding(slug: string): Promise<ActionResult<Redirect>> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");

  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", auth.user.id)
    .is("onboarded_at", null);

  await rememberWorkspace(slug);
  return ok({ redirectTo: routes.workspace(slug) });
}

async function rememberWorkspace(slug: string) {
  (await cookies()).set(LAST_WORKSPACE_COOKIE, slug, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
