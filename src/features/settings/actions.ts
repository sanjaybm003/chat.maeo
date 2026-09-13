"use server";

import { redirect } from "next/navigation";

import { fail, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { AVATAR_BUCKET } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DELETE_ACCOUNT_PHRASE } from "./constants";

/**
 * Removes workspaces the user owns alone, refuses if others depend on one, then
 * deletes the auth user. Messages they sent stay, attributed to a former member.
 */
export async function deleteAccount(confirmation: string): Promise<ActionResult> {
  if (confirmation.trim().toLowerCase() !== DELETE_ACCOUNT_PHRASE) {
    return fail(`Type “${DELETE_ACCOUNT_PHRASE}” to confirm.`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return fail("Your session ended. Sign in again.");

  const { error: prepareError } = await supabase.rpc("prepare_account_deletion");
  if (prepareError) return fail(getErrorMessage(prepareError));

  try {
    const admin = createSupabaseAdminClient();
    const { data: files } = await admin.storage.from(AVATAR_BUCKET).list(user.id);
    if (files?.length) {
      await admin.storage.from(AVATAR_BUCKET).remove(files.map((file) => `${user.id}/${file.name}`));
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return fail(getErrorMessage(error, "We couldn't delete your account. Try again."));
  } catch (error) {
    console.error("[account] deletion failed", error);
    return fail("Account deletion isn't configured on this server yet.");
  }

  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect(`${routes.login}?error=deleted`);
}
