"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { attachmentSummary, conversationTitle } from "@/features/chat/lib/conversation-meta";
import { isPushActive } from "@/features/notifications/push-client";
import { shouldThisTabAlert } from "@/lib/browser/tab-coordinator";
import { readPreferences } from "@/lib/preferences";
import { routes } from "@/lib/routes";
import { firstNameOf, nameOf } from "@/lib/utils";
import type { Conversation, Message } from "@/types/domain";

import { useWorkspaceStore } from "../store/workspace-provider";

let audioContext: AudioContext | null = null;
let lastChimeAt = 0;

/** Two soft sine notes, synthesised so there is no audio asset to ship. */
export function playChime() {
  const now = Date.now();
  if (now - lastChimeAt < 1500) return;
  lastChimeAt = now;

  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
    const context = audioContext;
    const start = context.currentTime;

    [659.25, 987.77].forEach((frequency, index) => {
      const at = start + index * 0.085;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.09, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.34);
    });
  } catch {
    // Audio is a nicety; never let it break message handling.
  }
}

/**
 * Alerts for incoming messages, exactly once per person: the visible tab
 * alerts, otherwise only the leader tab. When web push is active the service
 * worker owns background pop-ups, so tabs only chime.
 */
export function useNotifier() {
  const store = useWorkspaceStore();
  const router = useRouter();

  return useMemo(
    () => ({
      notify(message: Message, conversation: Conversation) {
        if (!shouldThisTabAlert()) return;

        const preferences = readPreferences();
        if (preferences.sound) playChime();

        if (
          !preferences.desktopNotifications ||
          isPushActive() ||
          typeof Notification === "undefined" ||
          Notification.permission !== "granted" ||
          document.visibilityState === "visible"
        ) {
          return;
        }

        const { members, me, workspace } = store.getState();
        const sender = message.senderId ? members[message.senderId] : null;
        const content = message.body.trim() || attachmentSummary(message.attachments.length);
        const isGroup = conversation.kind === "group";

        const notification = new Notification(isGroup ? conversationTitle(conversation, members, me.id) : nameOf(sender), {
          body: (isGroup ? `${firstNameOf(sender)}: ${content}` : content).slice(0, 160),
          tag: conversation.id,
          icon: "/icon.svg",
        });
        notification.onclick = () => {
          window.focus();
          router.push(routes.conversation(workspace.slug, conversation.id));
          notification.close();
        };
      },
    }),
    [store, router],
  );
}
