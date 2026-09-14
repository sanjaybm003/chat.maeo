"use server";

import { fail, ok, type ActionResult } from "@/lib/action-result";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { GithubError, listInstallationRepositories } from "./server/github";

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
