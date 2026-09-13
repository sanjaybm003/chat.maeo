"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { fetchAgent } from "@/features/ai/api";
import { watchActivity } from "@/lib/browser/activity";
import { startTabCoordinator } from "@/lib/browser/tab-coordinator";
import { logger } from "@/lib/logger";
import { routes } from "@/lib/routes";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Message } from "@/types/domain";

import { fetchConversation } from "../api/conversations";
import { fetchMember, fetchWorkspace, touchPresence } from "../api/members";
import { useNotifier } from "../notifications/notifier";
import type { WorkspaceRuntime } from "../runtime/workspace-runtime";
import { useWorkspace, useWorkspaceStore } from "../store/workspace-provider";
import { RealtimeEngine } from "./engine";

const RESYNC_AFTER_HIDDEN_MS = 30_000;
const PRESENCE_HEARTBEAT_MS = 60_000;

const log = logger.child({ module: "realtime-sync" });

/**
 * Connects the realtime engine to the store: applies events, raises alerts,
 * keeps presence honest, and triggers catch-up sync and outbox retries
 * whenever the connection comes back.
 */
export function useRealtimeSync({ outbox, sync }: WorkspaceRuntime) {
  const store = useWorkspaceStore();
  const router = useRouter();
  const notifier = useNotifier();
  const meId = useWorkspace((state) => state.me.id);
  const workspaceId = useWorkspace((state) => state.workspace.id);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const state = () => store.getState();
    const foreignConversations = new Set<string>();
    let disposed = false;
    let hiddenAt: number | null = null;

    async function handleMessageCreated(message: Message) {
      const fromOthers = message.senderId !== meId && message.kind === "text";
      // An agent reply arrives empty and fills in as it streams; it counts as unread, but a chime would ring before there's anything to read.
      const alert = fromOthers && !message.agentId;

      if (!state().conversations[message.conversationId]) {
        if (!foreignConversations.has(message.conversationId)) {
          const conversation = await fetchConversation(workspaceId, message.conversationId).catch(() => null);
          if (disposed) return;
          if (conversation) {
            state().upsertConversation(conversation);
            state().receiveMessage(message);
            if (alert && !conversation.muted) notifier.notify(message, conversation);
            return;
          }
          // Realtime feeds are per person, not per workspace.
          foreignConversations.add(message.conversationId);
        }
        if (alert) state().flagActivityElsewhere(true);
        return;
      }

      state().receiveMessage(message);
      if (!fromOthers) return;

      const viewing = state().activeConversationId === message.conversationId && document.visibilityState === "visible";
      if (!viewing) state().incrementUnread(message.conversationId);

      const conversation = state().conversations[message.conversationId];
      if (alert && conversation && !conversation.muted && (!viewing || !document.hasFocus())) {
        notifier.notify(message, conversation);
      }
    }

    async function refreshAgent(agentId: string) {
      const agent = await fetchAgent(agentId).catch(() => undefined);
      if (disposed || agent === undefined) return;
      if (agent) state().upsertAgent(agent);
      else state().removeAgent(agentId);
    }

    async function refreshConversation(conversationId: string) {
      if (foreignConversations.has(conversationId)) return;
      try {
        const conversation = await fetchConversation(workspaceId, conversationId);
        if (disposed || !conversation) return;
        // A 1:1 someone opened but hasn't written in yet shouldn't pop into the sidebar.
        const known = Boolean(state().conversations[conversationId]);
        if (known || conversation.lastMessage || conversation.createdBy === meId) {
          state().upsertConversation(conversation);
        }
      } catch (error) {
        log.warn("conversation refresh failed", { error });
      }
    }

    async function refreshMember(userId: string) {
      const member = await fetchMember(workspaceId, userId).catch(() => undefined);
      if (disposed || member === undefined) return;
      if (member) state().upsertMember(member);
      else state().removeMember(userId);
    }

    async function refreshWorkspace() {
      const workspace = await fetchWorkspace(workspaceId).catch(() => null);
      if (!disposed && workspace) state().setWorkspace(workspace);
    }

    const engine = new RealtimeEngine(
      supabase,
      { userId: meId, workspaceId },
      {
        onStatus: (status, { reconnected }) => {
          state().setConnection(status);
          if (reconnected) {
            void sync.request("reconnected");
            outbox.kick();
          }
        },
        onMessageCreated: (message) => void handleMessageCreated(message),
        onMessageUpdated: (message) => {
          if (state().conversations[message.conversationId]) state().receiveMessage(message, { keepReactions: true });
        },
        onReaction: (event, added) =>
          state().applyReaction(event.conversationId, event.messageId, { emoji: event.emoji, userId: event.userId }, added),
        onParticipantRead: (event) => state().setParticipantRead(event.conversationId, event.userId, event.lastReadAt),
        onConversationChanged: (conversationId) => void refreshConversation(conversationId),
        onConversationRemoved: (conversationId) => {
          if (!state().conversations[conversationId]) return;
          const wasActive = state().activeConversationId === conversationId;
          state().removeConversation(conversationId);
          if (wasActive) router.replace(routes.workspace(state().workspace.slug));
        },
        onWorkspaceRemoved: () => {
          toast.error(`You're no longer a member of ${state().workspace.name}.`);
          router.replace(routes.home);
          router.refresh();
        },
        onMemberChanged: (userId) => void refreshMember(userId),
        onWorkspaceUpdated: () => void refreshWorkspace(),
        onPresence: (entries) => state().setPresence(entries),
        onCreditsChanged: (balance) => state().setCreditBalance(balance),
        onAgentChanged: (agentId) => void refreshAgent(agentId),
      },
    );
    void engine.start();

    startTabCoordinator(meId);
    void touchPresence();
    const activity = watchActivity((status) => {
      engine.setPresenceStatus(status);
      if (status === "active") void touchPresence();
    });
    const heartbeat = window.setInterval(() => {
      if (activity.status === "active") void touchPresence();
    }, PRESENCE_HEARTBEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > RESYNC_AFTER_HIDDEN_MS) {
        hiddenAt = null;
        void sync.request("tab-visible");
        outbox.kick();
      }
    };
    const onOnline = () => {
      state().setConnection("reconnecting");
      void sync.request("online");
      outbox.kick();
    };
    const onOffline = () => state().setConnection("offline");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && !disposed) router.replace(routes.login);
    });

    return () => {
      disposed = true;
      void engine.stop();
      activity.dispose();
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      authListener.subscription.unsubscribe();
    };
  }, [store, router, notifier, meId, workspaceId, outbox, sync]);
}
