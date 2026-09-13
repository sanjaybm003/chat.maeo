import { db, unwrap } from "@/features/workspace/api/client";
import { mapProfile, mapWorkspace } from "@/lib/mappers";
import type { Database } from "@/types/database";

type ProfilePatch = Database["public"]["Tables"]["profiles"]["Update"];
type WorkspacePatch = Database["public"]["Tables"]["workspaces"]["Update"];

export async function updateOwnProfile(userId: string, patch: ProfilePatch) {
  return mapProfile(unwrap(await db().from("profiles").update(patch).eq("id", userId).select("*").single()));
}

export async function updateWorkspaceSettings(workspaceId: string, patch: WorkspacePatch) {
  return mapWorkspace(unwrap(await db().from("workspaces").update(patch).eq("id", workspaceId).select("*").single()));
}

export async function deleteWorkspace(workspaceId: string, confirmSlug: string) {
  unwrap(await db().rpc("delete_workspace", { p_workspace_id: workspaceId, p_confirm_slug: confirmSlug }));
}
