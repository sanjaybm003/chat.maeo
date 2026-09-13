"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef } from "react";

import { TYPING_BROADCAST_INTERVAL_MS } from "@/lib/constants";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { useWorkspace, useWorkspaceStore } from "../store/workspace-provider";
import { agentStreamSchema, typingEventSchema } from "./events";

/**
 * Ephemeral, per-conversation signals over a private channel only
 * participants may join:
 *   typing        peer to peer, never stored, throttled on send, expired on receive
 *   agent.stream  snapshots of an agent reply while it is being written
 */
export function useConversationChannel(conversationId: string) {
  const store = useWorkspaceStore();
  const meId = useWorkspace((state) => state.me.id);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let disposed = false;

    const channel = supabase
      .channel(`conversation:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const parsed = typingEventSchema.safeParse(payload);
        if (!parsed.success || parsed.data.userId === meId) return;
        const conversation = store.getState().conversations[conversationId];
        if (!conversation?.participants.some((participant) => participant.userId === parsed.data.userId)) return;
        store.getState().setTyping(conversationId, parsed.data.userId, parsed.data.typing);
      })
      .on("broadcast", { event: "agent.stream" }, ({ payload }) => {
        const parsed = agentStreamSchema.safeParse(payload);
        if (parsed.success) store.getState().applyAgentStream(conversationId, parsed.data.messageId, parsed.data.stream);
      });

    channelRef.current = channel;

    void supabase.realtime.setAuth().then(() => {
      if (!disposed) channel.subscribe();
    });

    return () => {
      disposed = true;
      if (lastTypingSentAt.current) {
        void channel.send({ type: "broadcast", event: "typing", payload: { user_id: meId, typing: false } });
      }
      lastTypingSentAt.current = 0;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, meId, store]);

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_BROADCAST_INTERVAL_MS) return;
    lastTypingSentAt.current = now;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { user_id: meId, typing: true } });
  }, [meId]);

  const stopTyping = useCallback(() => {
    if (!lastTypingSentAt.current) return;
    lastTypingSentAt.current = 0;
    void channelRef.current?.send({ type: "broadcast", event: "typing", payload: { user_id: meId, typing: false } });
  }, [meId]);

  return { sendTyping, stopTyping };
}
