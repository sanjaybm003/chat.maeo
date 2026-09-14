import { indexBy } from "../helpers";
import type { DirectorySlice, SliceCreator } from "../types";

export const createDirectorySlice: SliceCreator<DirectorySlice> = (set, _get, bootstrap) => ({
  me: bootstrap.me,
  workspace: bootstrap.workspace,
  myRole: bootstrap.myRole,
  workspaces: bootstrap.workspaces,
  members: indexBy(bootstrap.members),
  pendingInvitations: bootstrap.pendingInvitations,

  hydrate: (next) =>
    set((state) => {
      const conversations = indexBy(next.conversations);
      const active = state.activeConversationId;
      if (active && !conversations[active] && state.conversations[active]) {
        conversations[active] = state.conversations[active];
      }
      return {
        me: next.me,
        workspace: next.workspace,
        myRole: next.myRole,
        workspaces: next.workspaces,
        members: indexBy(next.members),
        conversations,
        pendingInvitations: next.pendingInvitations,
        aiReady: next.ai.ready,
        aiModels: next.ai.models,
        aiWebSearch: next.ai.webSearch,
        agents: indexBy(next.ai.agents),
        credits: next.ai.credits ?? state.credits,
      };
    }),

  setMe: (me) =>
    set((state) => ({
      me,
      members: state.members[me.id]
        ? { ...state.members, [me.id]: { ...state.members[me.id], ...me } }
        : state.members,
    })),

  setWorkspace: (workspace) =>
    set((state) => ({
      workspace,
      workspaces: state.workspaces.map((item) =>
        item.id === workspace.id ? { ...item, name: workspace.name, slug: workspace.slug } : item,
      ),
    })),

  setMembers: (members) => set({ members: indexBy(members) }),

  upsertMember: (member) =>
    set((state) => ({
      members: { ...state.members, [member.id]: member },
      ...(member.id === state.me.id ? { myRole: member.role, me: { ...state.me, ...member } } : {}),
    })),

  removeMember: (userId) =>
    set((state) => {
      if (!state.members[userId]) return {};
      const members = { ...state.members };
      const online = { ...state.online };
      const away = { ...state.away };
      delete members[userId];
      delete online[userId];
      delete away[userId];
      return { members, online, away };
    }),
});
