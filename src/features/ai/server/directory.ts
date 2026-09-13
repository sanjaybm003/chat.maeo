import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type AdminClient = SupabaseClient<Database>;

export interface DirectoryPerson {
  id: string;
  name: string;
  title: string | null;
  role: string;
  status: string | null;
}

/** Names for everyone (and every agent) a run might mention, loaded once per run. */
export class NameDirectory {
  private constructor(
    readonly workspaceName: string,
    readonly people: Map<string, DirectoryPerson>,
    readonly agents: Map<string, { name: string; handle: string }>,
  ) {}

  static async load(admin: AdminClient, workspaceId: string): Promise<NameDirectory> {
    const [workspaceResult, membersResult, agentsResult] = await Promise.all([
      admin.from("workspaces").select("name").eq("id", workspaceId).single(),
      admin.from("workspace_members").select("user_id, role").eq("workspace_id", workspaceId),
      admin.from("ai_agents").select("id, name, handle").eq("workspace_id", workspaceId),
    ]);
    if (workspaceResult.error) throw workspaceResult.error;
    if (membersResult.error) throw membersResult.error;
    if (agentsResult.error) throw agentsResult.error;

    const members = membersResult.data ?? [];
    const profilesResult = members.length
      ? await admin
          .from("profiles")
          .select("id, full_name, display_name, email, title, status_text")
          .in(
            "id",
            members.map((member) => member.user_id),
          )
      : { data: [], error: null };
    if (profilesResult.error) throw profilesResult.error;

    const roles = new Map(members.map((member) => [member.user_id, member.role]));
    const people = new Map<string, DirectoryPerson>();
    for (const profile of profilesResult.data ?? []) {
      people.set(profile.id, {
        id: profile.id,
        name: profile.full_name || profile.display_name || profile.email.split("@")[0] || "Teammate",
        title: profile.title,
        role: roles.get(profile.id) ?? "member",
        status: profile.status_text,
      });
    }

    const agents = new Map((agentsResult.data ?? []).map((agent) => [agent.id, { name: agent.name, handle: agent.handle }]));
    return new NameDirectory(workspaceResult.data.name, people, agents);
  }

  personName(userId: string | null | undefined) {
    return (userId && this.people.get(userId)?.name) || "A former member";
  }

  authorName(message: { sender_id: string | null; agent_id: string | null }) {
    if (message.agent_id) {
      const agent = this.agents.get(message.agent_id);
      return agent ? `${agent.name} (AI agent @${agent.handle})` : "An AI agent";
    }
    return this.personName(message.sender_id);
  }
}
