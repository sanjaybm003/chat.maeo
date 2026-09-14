import { db, unwrap } from "@/features/workspace/api/client";
import { mapIntegration } from "@/lib/mappers";
import type { IntegrationProvider } from "@/types/domain";

export async function fetchIntegrations(workspaceId: string) {
  const rows = unwrap(await db().from("workspace_integrations").select("*").eq("workspace_id", workspaceId));
  return (rows ?? []).flatMap((row) => mapIntegration(row) ?? []);
}

export async function disconnectIntegration(workspaceId: string, provider: IntegrationProvider) {
  return unwrap(await db().rpc("disconnect_workspace_integration", { p_workspace_id: workspaceId, p_provider: provider }));
}

export async function setDefaultRepository(workspaceId: string, repo: string | null) {
  return unwrap(await db().rpc("set_integration_default_repo", { p_workspace_id: workspaceId, p_provider: "github", p_repo: repo }));
}

/** Starts the GitHub App installation for a workspace; the server checks who's asking. */
export const githubInstallPath = (slug: string) => `/api/integrations/github/install?workspace=${encodeURIComponent(slug)}`;
