"use server";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import { serverEnv } from "@/lib/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { GithubError, listInstallationRepositories } from "./server/github";
import { sendTestTaskEvent } from "./server/task-webhooks";

export interface RepositoryOption {
  fullName: string;
  private: boolean;
}

/** The repositories the workspace's GitHub installation can reach, for choosing a default. */
export async function listGithubRepositories(workspaceId: string): Promise<ActionResult<RepositoryOption[]>> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");

  // Read as the person, so only members of the workspace reach its connection.
  const { data: row } = await supabase
    .from("workspace_integrations")
    .select("external_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "github")
    .maybeSingle();
  if (!row) return fail("GitHub isn’t connected to this workspace.");

  try {
    const repositories = await listInstallationRepositories(row.external_id);
    return ok(repositories.map((repo) => ({ fullName: repo.fullName, private: repo.private })));
  } catch (error) {
    if (error instanceof GithubError && (error.status === 401 || error.status === 404)) {
      return fail("The GitHub app was removed. Disconnect, then connect GitHub again.");
    }
    return fail("Couldn’t reach GitHub. Try again.");
  }
}

/** Sends a sample task event to one webhook, so an admin sees it arrive. Returns the app's HTTP status, 0 if unreachable. */
export async function testTaskWebhook(workspaceId: string, webhookId: string): Promise<ActionResult<{ status: number }>> {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");
  if (!serverEnv.hasServiceRoleKey) return fail("Webhooks aren’t available on this server right now.");

  // Read as the person: only a workspace's admins can see its webhooks.
  const { data: row } = await supabase.from("task_webhooks").select("id").eq("id", webhookId).eq("workspace_id", workspaceId).maybeSingle();
  if (!row) return fail("Only workspace admins can test webhooks.");

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("display_name, full_name, email").eq("id", auth.user.id).maybeSingle();
  const actorName = profile ? profile.display_name || profile.full_name || profile.email.split("@")[0] : "Someone";
  try {
    const status = await sendTestTaskEvent(admin, { workspaceId, webhookId, actorName });
    return status === null ? fail("That webhook no longer exists.") : ok({ status });
  } catch {
    return fail("Couldn’t send the test. Try again.");
  }
}
