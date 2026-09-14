"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconCopy, IconTrash } from "@/components/ui/icons";
import { inputStyles } from "@/components/ui/input";
import { LocalTime } from "@/components/ui/local-time";
import { conversationTitle } from "@/features/chat/lib/conversation-meta";
import { SettingsSection } from "@/features/settings/components/settings-chrome";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

import { testTaskWebhook } from "../actions";
import {
  chatWebhookUrl,
  createChatWebhook,
  createTaskWebhook,
  deleteChatWebhook,
  deleteTaskWebhook,
  fetchChatWebhooks,
  fetchTaskWebhooks,
  type ChatWebhook,
  type TaskWebhook,
} from "../api";
import { TASK_EVENT_LABELS, TASK_EVENTS, WEBHOOK_FORMAT_LABELS, WEBHOOK_FORMATS, type TaskEvent, type WebhookFormat } from "../lib/task-events";

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied the ${what}.`);
  } catch {
    toast.error("Couldn’t copy. Select it and copy it yourself.");
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/** Loads a list admins can see, once per workspace; members get nothing to load. */
function useAdminList<T>(enabled: boolean, workspaceId: string, load: (workspaceId: string) => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    load(workspaceId)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(getErrorMessage(error, "Couldn’t load these. Refresh to try again."));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, workspaceId, load]);
  return { items, setItems, problem };
}

function Card({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-[20px] border border-line bg-surface">{children}</div>;
}

function Note({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "danger" }) {
  return <p className={cn("border-t border-line px-4 py-3 text-[13px]", tone === "danger" ? "text-danger" : "text-ink-3")}>{children}</p>;
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[12.5px] text-ink-3", className)}>
      {label}
      {children}
    </label>
  );
}

/** A secret shown once, with a copy button. */
function RevealOnce({ label, value, children, onDone }: { label: string; value: string; children?: ReactNode; onDone: () => void }) {
  return (
    <div className="border-t border-line bg-paper px-4 py-4">
      <p className="text-[13.5px] font-semibold text-ink">{label}</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">Copy it now. For your security it won’t be shown again.</p>
      <div className="mt-2.5 flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={label}
          className={cn(inputStyles, "h-9 min-w-0 flex-1 py-0 font-mono text-[12px]")}
        />
        <Button size="sm" variant="secondary" onClick={() => void copyText(value, label.toLowerCase())}>
          <IconCopy size={15} />
          Copy
        </Button>
      </div>
      {children}
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function IncomingWebhooks({ isAdmin }: { isAdmin: boolean }) {
  const workspaceId = useWorkspace((state) => state.workspace.id);
  const conversations = useWorkspace((state) => state.conversations);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const meId = useWorkspace((state) => state.me.id);
  const { items, setItems, problem } = useAdminList(isAdmin, workspaceId, fetchChatWebhooks);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ChatWebhook | null>(null);

  const chats = useMemo(
    () =>
      Object.values(conversations)
        .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
        .map((conversation) => ({ id: conversation.id, title: conversationTitle(conversation, members, meId, agents) })),
    [conversations, members, meId, agents],
  );
  const conversationId = picked || chats[0]?.id || "";

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!conversationId || !name.trim()) return;
    setCreating(true);
    try {
      const { webhook, token } = await createChatWebhook(conversationId, name.trim());
      setItems((current) => [webhook, ...(current ?? [])]);
      setCreated(chatWebhookUrl(window.location.origin, webhook.id, token));
      setName("");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn’t create the webhook."));
    } finally {
      setCreating(false);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await deleteChatWebhook(removing.id);
      setItems((current) => (current ?? []).filter((item) => item.id !== removing.id));
      toast.success("Webhook deleted. That link no longer works.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn’t delete the webhook."));
      throw error;
    }
  }

  const titleOf = (id: string) => chats.find((chat) => chat.id === id)?.title ?? "a chat you’re not in";

  return (
    <SettingsSection
      title="Post into chats"
      description="Give any app a private link, and what it sends shows up in a chat: deploys, alerts, form entries, new leads. Agents in that chat can read it, so you can ask “@dev why did this fail?” right below."
    >
      {isAdmin ? (
        <Card>
          <form onSubmit={(event) => void create(event)} className="flex flex-wrap items-end gap-2 px-4 py-4">
            <Field label="Name" className="min-w-[160px] flex-1">
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Deploys" className={cn(inputStyles, "h-9 py-0")} />
            </Field>
            <Field label="Posts into" className="min-w-[180px] flex-1">
              <select value={conversationId} onChange={(event) => setPicked(event.target.value)} className={cn(inputStyles, "h-9 py-0")}>
                {chats.map((chat) => (
                  <option key={chat.id} value={chat.id}>
                    {chat.title}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" size="sm" loading={creating} disabled={!name.trim() || !conversationId}>
              Create link
            </Button>
          </form>

          {created ? (
            <RevealOnce label="Webhook link" value={created} onDone={() => setCreated(null)}>
              <pre className="mt-3 overflow-x-auto rounded-[12px] border border-line bg-surface px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
                {`curl -X POST '${created}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"text": "Deploy finished", "username": "CI"}'`}
              </pre>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">It also accepts what apps send to Slack or Discord, so you can paste it where they ask for one of those.</p>
            </RevealOnce>
          ) : null}

          {problem ? (
            <Note tone="danger">{problem}</Note>
          ) : items === null ? (
            <Note>Loading…</Note>
          ) : items.length === 0 ? (
            <Note>No incoming webhooks yet.</Note>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{item.name}</p>
                    <p className="truncate text-[12.5px] text-ink-3">
                      Into {titleOf(item.conversationId)} ·{" "}
                      {item.lastUsedAt ? (
                        <>
                          last post <LocalTime iso={item.lastUsedAt} format="list" />
                        </>
                      ) : (
                        "no posts yet"
                      )}
                    </p>
                  </div>
                  <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(item)}>
                    <IconTrash size={15} />
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <p className="text-[13.5px] text-ink-3">Ask a workspace admin to add incoming webhooks.</p>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Delete “${removing?.name ?? "this webhook"}”?`}
        description="Apps using its link can’t post anymore. Messages they already posted stay in the chat."
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </SettingsSection>
  );
}

function deliveryLabel(item: TaskWebhook) {
  if (item.lastStatus === null) return "not sent yet";
  if (item.lastStatus >= 200 && item.lastStatus < 300) return "last delivery worked";
  return item.lastStatus === 0 ? "last delivery couldn’t reach it" : `last delivery failed (${item.lastStatus})`;
}

const DEFAULT_EVENTS: TaskEvent[] = ["task.created", "task.assigned", "task.completed"];

function TaskWebhooks({ isAdmin }: { isAdmin: boolean }) {
  const workspaceId = useWorkspace((state) => state.workspace.id);
  const { items, setItems, problem } = useAdminList(isAdmin, workspaceId, fetchTaskWebhooks);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<WebhookFormat>("slack");
  const [events, setEvents] = useState<TaskEvent[]>(DEFAULT_EVENTS);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TaskWebhook | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !url.trim() || events.length === 0) return;
    setCreating(true);
    try {
      const created = await createTaskWebhook(workspaceId, { name: name.trim(), url: url.trim(), format, events });
      setItems((current) => [created.webhook, ...(current ?? [])]);
      setSecret(created.webhook.format === "json" ? created.secret : null);
      setName("");
      setUrl("");
      toast.success(`${created.webhook.name} will hear about tasks. Send a test to check it.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn’t add the webhook."));
    } finally {
      setCreating(false);
    }
  }

  async function test(item: TaskWebhook) {
    setTesting(item.id);
    try {
      const result = await testTaskWebhook(workspaceId, item.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { status } = result.data;
      setItems((current) =>
        (current ?? []).map((entry) => (entry.id === item.id ? { ...entry, lastStatus: status, lastDeliveredAt: new Date().toISOString() } : entry)),
      );
      if (status >= 200 && status < 300) toast.success(`${item.name} got the test.`);
      else toast.error(status === 0 ? `Couldn’t reach ${hostOf(item.url)}.` : `${hostOf(item.url)} answered ${status}.`);
    } finally {
      setTesting(null);
    }
  }

  async function remove() {
    if (!removing) return;
    try {
      await deleteTaskWebhook(removing.id);
      setItems((current) => (current ?? []).filter((item) => item.id !== removing.id));
      toast.success("Webhook deleted.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn’t delete the webhook."));
      throw error;
    }
  }

  return (
    <SettingsSection
      title="Send task updates"
      description="Tell Slack, Google Chat, Discord or your own systems when tasks are created, assigned, finished or changed, including changes agents make."
    >
      {isAdmin ? (
        <Card>
          <form onSubmit={(event) => void create(event)} className="flex flex-col gap-3 px-4 py-4">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Name" className="min-w-[140px] flex-1">
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Team Slack" className={cn(inputStyles, "h-9 py-0")} />
              </Field>
              <Field label="Sends" className="min-w-[170px]">
                <select value={format} onChange={(event) => setFormat(event.target.value as WebhookFormat)} className={cn(inputStyles, "h-9 py-0")}>
                  {WEBHOOK_FORMATS.map((option) => (
                    <option key={option} value={option}>
                      {WEBHOOK_FORMAT_LABELS[option]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Address">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                type="url"
                inputMode="url"
                placeholder={format === "discord" ? "https://discord.com/api/webhooks/…" : format === "slack" ? "https://hooks.slack.com/services/…" : "https://"}
                className={cn(inputStyles, "h-9 py-0 font-mono text-[12.5px]")}
              />
            </Field>
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <legend className="mb-1.5 text-[12.5px] text-ink-3">When a task is</legend>
              {TASK_EVENTS.map((option) => (
                <label key={option} className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={events.includes(option)}
                    onChange={(event) =>
                      setEvents((current) => (event.target.checked ? [...current, option] : current.filter((item) => item !== option)))
                    }
                    className="size-4 accent-[var(--ink)]"
                  />
                  {TASK_EVENT_LABELS[option].toLowerCase()}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end">
              <Button type="submit" size="sm" loading={creating} disabled={!name.trim() || !url.trim() || events.length === 0}>
                Add webhook
              </Button>
            </div>
          </form>

          {secret ? (
            <RevealOnce label="Signing secret" value={secret} onDone={() => setSecret(null)}>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">
                Every request carries <code className="font-mono text-[11.5px]">X-Maeosan-Timestamp</code> and{" "}
                <code className="font-mono text-[11.5px]">X-Maeosan-Signature</code>: <code className="font-mono text-[11.5px]">sha256=</code> followed by the
                HMAC-SHA256 of the timestamp, a dot and the raw body, keyed with this secret. Check it before trusting a request.
              </p>
            </RevealOnce>
          ) : null}

          {problem ? (
            <Note tone="danger">{problem}</Note>
          ) : items === null ? (
            <Note>Loading…</Note>
          ) : items.length === 0 ? (
            <Note>No task webhooks yet.</Note>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">
                      {item.name} <span className="font-mono text-[11px] font-normal text-ink-3">· {WEBHOOK_FORMAT_LABELS[item.format]}</span>
                    </p>
                    <p className="truncate text-[12.5px] text-ink-3">
                      {hostOf(item.url)} · {item.events.map((event) => TASK_EVENT_LABELS[event].toLowerCase()).join(", ")} · {deliveryLabel(item)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" loading={testing === item.id} onClick={() => void test(item)}>
                    Send test
                  </Button>
                  <Button size="sm" variant="danger-ghost" onClick={() => setRemoving(item)}>
                    <IconTrash size={15} />
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <p className="text-[13.5px] text-ink-3">Ask a workspace admin to add task webhooks.</p>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Delete “${removing?.name ?? "this webhook"}”?`}
        description="It stops hearing about tasks right away."
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </SettingsSection>
  );
}

/** Incoming and outgoing webhooks, for the Connected apps page. */
export function WebhooksSettings() {
  const isAdmin = useWorkspace((state) => state.myRole !== "member");
  return (
    <>
      <IncomingWebhooks isAdmin={isAdmin} />
      <TaskWebhooks isAdmin={isAdmin} />
    </>
  );
}
