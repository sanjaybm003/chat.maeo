import type { RealtimeChannel } from "@supabase/supabase-js";
import type { ZodType } from "zod";

import { KeyedDebouncer } from "@/lib/async/keyed-debouncer";
import { logger } from "@/lib/logger";
import { mapMessage } from "@/lib/mappers";
import type { BrowserSupabase } from "@/lib/supabase/client";
import type { Message, PresenceStatus } from "@/types/domain";

import type { ConnectionState, PresenceEntry } from "../store/types";
import {
  conversationRefSchema,
  readEventSchema,
  reactionEventSchema,
  userRefSchema,
  workspaceRefSchema,
  type ReactionEvent,
  type ReadEvent,
} from "./events";

export interface RealtimeEngineHandlers {
  onStatus: (status: ConnectionState, meta: { reconnected: boolean }) => void;
  onMessageCreated: (message: Message) => void;
  onMessageUpdated: (message: Message) => void;
  onReaction: (event: ReactionEvent, added: boolean) => void;
  onParticipantRead: (event: ReadEvent) => void;
  /** Debounced per conversation. */
  onConversationChanged: (conversationId: string) => void;
  onConversationRemoved: (conversationId: string) => void;
  onWorkspaceRemoved: () => void;
  /** Debounced per member. */
  onMemberChanged: (userId: string) => void;
  /** Debounced. */
  onWorkspaceUpdated: () => void;
  onPresence: (entries: PresenceEntry[]) => void;
}

const log = logger.child({ module: "realtime-engine" });

/**
 * Owns the WebSocket channels for one workspace session, independent of React.
 *
 *   user:<id>        personal feed, fanned out by Postgres triggers
 *   workspace:<id>   presence (active / away) and membership hints
 *
 * It validates every payload, coalesces bursts of refresh hints, isolates
 * handler failures, and reports connection state including reconnects so the
 * caller can run a catch-up sync.
 */
export class RealtimeEngine {
  private feed: RealtimeChannel | null = null;
  private room: RealtimeChannel | null = null;
  private disposed = false;
  private connectedOnce = false;
  private presenceStatus: PresenceStatus = "active";
  private readonly conversationRefresh: KeyedDebouncer<string>;
  private readonly memberRefresh: KeyedDebouncer<string>;
  private readonly workspaceRefresh: KeyedDebouncer<"workspace">;

  constructor(
    private readonly supabase: BrowserSupabase,
    private readonly scope: { userId: string; workspaceId: string },
    private readonly handlers: RealtimeEngineHandlers,
  ) {
    this.conversationRefresh = new KeyedDebouncer(200, (conversationId) => handlers.onConversationChanged(conversationId));
    this.memberRefresh = new KeyedDebouncer(400, (userId) => handlers.onMemberChanged(userId));
    this.workspaceRefresh = new KeyedDebouncer(400, () => handlers.onWorkspaceUpdated());
  }

  async start() {
    try {
      await this.supabase.realtime.setAuth();
    } catch (error) {
      log.warn("realtime authorisation failed", { error });
    }
    if (this.disposed) return;

    const { userId, workspaceId } = this.scope;

    this.feed = this.supabase
      .channel(`user:${userId}`, { config: { private: true } })
      .on("broadcast", { event: "message.created" }, ({ payload }) =>
        this.withMessage(payload, (message) => this.handlers.onMessageCreated(message)),
      )
      .on("broadcast", { event: "message.updated" }, ({ payload }) =>
        this.withMessage(payload, (message) => this.handlers.onMessageUpdated(message)),
      )
      .on("broadcast", { event: "reaction.added" }, ({ payload }) =>
        this.parse(reactionEventSchema, payload, (event) => this.handlers.onReaction(event, true)),
      )
      .on("broadcast", { event: "reaction.removed" }, ({ payload }) =>
        this.parse(reactionEventSchema, payload, (event) => this.handlers.onReaction(event, false)),
      )
      .on("broadcast", { event: "participant.read" }, ({ payload }) =>
        this.parse(readEventSchema, payload, (event) => this.handlers.onParticipantRead(event)),
      )
      .on("broadcast", { event: "conversation.changed" }, ({ payload }) =>
        this.parse(conversationRefSchema, payload, (conversationId) => this.conversationRefresh.schedule(conversationId)),
      )
      .on("broadcast", { event: "conversation.removed" }, ({ payload }) =>
        this.parse(conversationRefSchema, payload, (conversationId) => this.handlers.onConversationRemoved(conversationId)),
      )
      .on("broadcast", { event: "workspace.removed" }, ({ payload }) =>
        this.parse(workspaceRefSchema, payload, (removedId) => {
          if (removedId === workspaceId) this.handlers.onWorkspaceRemoved();
        }),
      )
      .subscribe((status) => this.onFeedStatus(status));

    this.room = this.supabase
      .channel(`workspace:${workspaceId}`, { config: { private: true, presence: { key: userId, enabled: true } } })
      .on("presence", { event: "sync" }, () => this.emitPresence())
      .on("broadcast", { event: "member.changed" }, ({ payload }) =>
        this.parse(userRefSchema, payload, (memberId) => this.memberRefresh.schedule(memberId)),
      )
      .on("broadcast", { event: "member.removed" }, ({ payload }) =>
        this.parse(userRefSchema, payload, (memberId) => this.memberRefresh.schedule(memberId)),
      )
      .on("broadcast", { event: "workspace.updated" }, () => this.workspaceRefresh.schedule("workspace"))
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !this.disposed) void this.track();
      });
  }

  /** Active or away; re-announced to everyone in the workspace when it changes. */
  setPresenceStatus(status: PresenceStatus) {
    if (status === this.presenceStatus) return;
    this.presenceStatus = status;
    void this.track();
  }

  async stop() {
    this.disposed = true;
    this.conversationRefresh.cancelAll();
    this.memberRefresh.cancelAll();
    this.workspaceRefresh.cancelAll();
    const channels = [this.feed, this.room].filter((channel): channel is RealtimeChannel => channel !== null);
    this.feed = null;
    this.room = null;
    await Promise.all(channels.map((channel) => this.supabase.removeChannel(channel)));
  }

  private onFeedStatus(status: string) {
    if (this.disposed) return;
    if (status === "SUBSCRIBED") {
      const reconnected = this.connectedOnce;
      this.connectedOnce = true;
      this.handlers.onStatus("live", { reconnected });
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      this.handlers.onStatus("reconnecting", { reconnected: false });
    } else if (status === "CLOSED") {
      this.handlers.onStatus(navigator.onLine ? "reconnecting" : "offline", { reconnected: false });
    }
  }

  private async track() {
    if (!this.room || this.disposed) return;
    try {
      await this.room.track({
        user_id: this.scope.userId,
        status: this.presenceStatus,
        online_at: new Date().toISOString(),
      });
    } catch (error) {
      log.warn("presence update failed", { error });
    }
  }

  private emitPresence() {
    if (!this.room) return;
    const state = this.room.presenceState<{ status?: string }>();
    // A person with several tabs counts as active if any tab is.
    const entries: PresenceEntry[] = Object.entries(state).map(([userId, metas]) => ({
      userId,
      status: metas.some((meta) => meta.status !== "away") ? "active" : "away",
    }));
    this.dispatch("presence", () => this.handlers.onPresence(entries));
  }

  private withMessage(payload: unknown, run: (message: Message) => void) {
    const message = mapMessage(payload);
    if (!message) {
      log.warn("dropped malformed message payload");
      return;
    }
    this.dispatch("message", () => run(message));
  }

  private parse<T>(schema: ZodType<T>, payload: unknown, run: (value: T) => void) {
    const result = schema.safeParse(payload);
    if (!result.success) {
      log.warn("dropped malformed realtime payload", { issues: result.error.issues.length });
      return;
    }
    this.dispatch("event", () => run(result.data));
  }

  private dispatch(event: string, run: () => void) {
    try {
      run();
    } catch (error) {
      log.error("realtime handler failed", { event, error });
    }
  }
}
