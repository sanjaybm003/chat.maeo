import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { mapPendingInvitation, mapProfile, mapWorkspaceSummary } from "@/lib/mappers";
import { routes } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** One Supabase client per request, shared by every loader in that request. */
export const getServerSupabase = cache(createSupabaseServerClient);

/** Verified with the Auth server, never trusted from the cookie alone. */
export const getAuthUser = cache(async () => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireAuthUser(next?: string) {
  const user = await getAuthUser();
  if (!user) {
    redirect(next ? `${routes.login}?next=${encodeURIComponent(next)}` : routes.login);
  }
  return user;
}

export const getOwnProfile = cache(async (userId: string) => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data ? mapProfile(data) : null;
});

export const getMyWorkspaces = cache(async () => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_workspaces");
  if (error) throw error;
  return (data ?? []).map(mapWorkspaceSummary);
});

export const getMyPendingInvitations = cache(async () => {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("my_pending_invitations");
  if (error) throw error;
  return (data ?? []).map(mapPendingInvitation);
});

/** Invited users arrive through a magic link and have never chosen a password. */
export function needsPassword(user: { invited_at?: string | null; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }) {
  const provider = user.app_metadata?.provider;
  return Boolean(user.invited_at) && provider === "email" && user.user_metadata?.password_set !== true;
}
