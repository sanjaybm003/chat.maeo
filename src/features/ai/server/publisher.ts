import "server-only";

import { logger } from "@/lib/logger";
import type { AgentRunStep } from "@/types/domain";

import type { AdminClient } from "./directory";

const FLUSH_INTERVAL_MS = 220;
const MAX_STREAM_CHARS = 16_000;
const MAX_STEPS = 12;

const log = logger.child({ module: "agent-stream" });

/**
 * Broadcasts a reply's progress to everyone viewing the conversation. Sends
 * full snapshots on a short timer, so a dropped or reordered event is simply
 * replaced by the next one and late viewers catch up immediately.
 */
export class StreamPublisher {
  private text = "";
  private steps: AgentRunStep[] = [];
  private seq = 0;
  private dirty = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private lastFlushAt = 0;

  constructor(
    private readonly admin: AdminClient,
    private readonly ids: { conversationId: string; messageId: string; runId: string },
  ) {}

  setText(text: string) {
    this.text = text;
    this.schedule();
  }

  addStep(step: AgentRunStep) {
    this.steps = [...this.steps, step].slice(-MAX_STEPS);
    this.schedule();
  }

  async close() {
    clearTimeout(this.timer);
    this.closed = true;
    await this.chain;
  }

  private schedule() {
    this.dirty = true;
    if (this.timer || this.closed) return;
    // The first words and steps go out at once; after that, at most one snapshot per interval.
    const wait = Math.max(0, FLUSH_INTERVAL_MS - (Date.now() - this.lastFlushAt));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  private flush() {
    if (!this.dirty || this.closed) return;
    this.dirty = false;
    this.lastFlushAt = Date.now();
    this.seq += 1;
    const payload = {
      run_id: this.ids.runId,
      message_id: this.ids.messageId,
      seq: this.seq,
      status: this.text ? "working" : "thinking",
      text: this.text.slice(0, MAX_STREAM_CHARS),
      steps: this.steps.map((step) => ({ kind: step.kind, label: step.label })),
    };
    this.chain = this.chain
      .then(async () => {
        const { error } = await this.admin.rpc("ai_broadcast", {
          p_conversation_id: this.ids.conversationId,
          p_payload: payload,
        });
        if (error) log.warn("stream broadcast failed", { runId: this.ids.runId, error });
      })
      .catch((error) => log.warn("stream broadcast failed", { runId: this.ids.runId, error }));
  }
}
