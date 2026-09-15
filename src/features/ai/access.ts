import type { Agent, AgentMemberRole, WorkspaceRole } from "@/types/domain";

/**
 * What a person may do with an agent they can already see: the database
 * decides for real (private.agent_access_for); this keeps the interface honest
 * about it. An agent reaches this person's store only if they can see it.
 */

export type AgentAccess = "view" | "use" | "edit";

type AccessFields = Pick<Agent, "createdBy" | "visibility" | "usage" | "members">;

export function agentAccess(agent: AccessFields, meId: string, myRole: WorkspaceRole): AgentAccess {
  if (agent.createdBy === meId) return "edit";
  if (agent.visibility === "private") return "view";
  const role = agent.members.find((member) => member.userId === meId)?.role ?? null;
  // Seen only because it works in one of this person's chats.
  if (agent.visibility !== "workspace" && role === null) return "view";
  if (role === "editor" || myRole !== "member") return "edit";
  return agent.usage === "viewers" || (agent.usage === "people" && role === "user") ? "use" : "view";
}

export const canUseAgent = (agent: AccessFields, meId: string, myRole: WorkspaceRole) => agentAccess(agent, meId, myRole) !== "view";

export const canEditAgent = (agent: AccessFields, meId: string, myRole: WorkspaceRole) => agentAccess(agent, meId, myRole) === "edit";

/** Changing who has an agent stays with its maker and the workspace's admins. */
export const canShareAgent = (agent: AccessFields, meId: string, myRole: WorkspaceRole) =>
  agent.createdBy === meId || (myRole !== "member" && agentAccess(agent, meId, myRole) === "edit");

export const MEMBER_ROLE_LABELS: Record<AgentMemberRole, { label: string; summary: string }> = {
  viewer: { label: "Can see", summary: "Sees it and its replies" },
  user: { label: "Can use", summary: "Talks to it and gives it work" },
  editor: { label: "Can edit", summary: "Also changes how it works" },
};

/** One line on who has an agent, for cards and profiles. */
export function describeSharing(agent: Pick<Agent, "visibility" | "usage" | "members">) {
  if (agent.visibility === "private") return "Only its maker";
  const people = agent.members.length;
  const seen = agent.visibility === "workspace" ? "Everyone here sees it" : `Shared with ${people} ${people === 1 ? "person" : "people"}`;
  const used =
    agent.usage === "viewers"
      ? agent.visibility === "workspace"
        ? "and can use it"
        : ""
      : agent.usage === "people"
        ? "· chosen people use it"
        : "· only its maker uses it";
  return [seen, used].filter(Boolean).join(" ");
}
