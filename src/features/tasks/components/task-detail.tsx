"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconArrowLeft, IconCalendar, IconChat, IconLink, IconTrash } from "@/components/ui/icons";
import { LocalTime } from "@/components/ui/local-time";
import { Spinner } from "@/components/ui/spinner";
import { openAgentConversation } from "@/features/ai/api";
import { AgentAvatar } from "@/features/ai/components/agent-avatar";
import { useSendToConversation } from "@/features/chat/hooks/use-send-to-conversation";
import { conversationTitle } from "@/features/chat/lib/conversation-meta";
import { useOpenConversation } from "@/features/workspace/hooks/use-open-conversation";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { nameOf } from "@/lib/utils";
import type { Agent, Task } from "@/types/domain";

import { fetchTaskByNumber } from "../api";
import { useTaskActions } from "../hooks/use-task-actions";
import { isOpenTask, TASK_PRIORITY_META, TASK_STATUS_META, taskKey } from "../lib/task-meta";
import { TaskEditor } from "./task-editor";
import { AssigneePicker, DueLabel, DuePicker, FieldButton, PriorityMenu, StatusMenu, TaskAssigneeAvatar, useAssigneeName } from "./task-fields";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

/** What an agent is told when someone asks it to start on a task. */
export function handOffMessage(task: Task) {
  return [
    `Please work on ${taskKey(task.number)}: ${task.title}`,
    task.description.trim(),
    task.dueOn ? `It’s due ${task.dueOn}.` : "",
    "Share what you find or make here, and keep the task’s status up to date as you go.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function TaskDetail({ number }: { number: number }) {
  const store = useWorkspaceStore();
  const workspaceId = useWorkspace((state) => state.workspace.id);
  const slug = useWorkspace((state) => state.workspace.slug);
  const tasksReady = useWorkspace((state) => state.tasksReady);
  const task = useWorkspace((state) => Object.values(state.tasks).find((item) => item.number === number) ?? null);
  const [missing, setMissing] = useState(false);

  // Older finished tasks aren't kept in memory; fetch this one on demand.
  useEffect(() => {
    if (task || !tasksReady) return;
    let cancelled = false;
    fetchTaskByNumber(workspaceId, number)
      .then((found) => {
        if (cancelled) return;
        if (found) store.getState().upsertTask(found);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [task, tasksReady, workspaceId, number, store]);

  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {missing || !tasksReady ? (
          <>
            <p className="font-display text-2xl font-semibold tracking-[-0.02em]">{taskKey(number)} isn’t here.</p>
            <p className="max-w-sm text-sm text-ink-3">It may have been deleted, or the number is wrong.</p>
            <Button asChild variant="secondary" className="mt-2">
              <Link href={routes.tasks(slug)}>Back to tasks</Link>
            </Button>
          </>
        ) : (
          <Spinner size={18} className="text-ink-3" />
        )}
      </div>
    );
  }

  return <TaskPage task={task} />;
}

function TaskPage({ task }: { task: Task }) {
  const router = useRouter();
  const slug = useWorkspace((state) => state.workspace.slug);
  const me = useWorkspace((state) => state.me);
  const myRole = useWorkspace((state) => state.myRole);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const conversation = useWorkspace((state) => (task.conversationId ? state.conversations[task.conversationId] : undefined));
  const assignedAgent = task.agentId ? (agents[task.agentId] ?? null) : null;
  const creatorAgent = task.createdByAgent ? (agents[task.createdByAgent] ?? null) : null;
  const assigneeName = useAssigneeName(task);
  const openConversation = useOpenConversation();
  const actions = useTaskActions();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canDelete = task.createdBy === me.id || myRole !== "member";
  const creator = task.createdBy === me.id ? "You" : nameOf(task.createdBy ? members[task.createdBy] : null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${routes.task(slug, task.number)}`);
      toast.success(`Copied a link to ${taskKey(task.number)}.`);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  async function remove() {
    const removed = await actions.remove(task);
    if (!removed) throw new Error("not deleted");
    toast.success(`${taskKey(task.number)} was deleted.`);
    router.push(routes.tasks(slug));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1060px] px-5 pb-24 pt-5 sm:px-10 sm:pt-8">
        <Link
          href={routes.tasks(slug)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full pl-2 pr-3 text-[13.5px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <IconArrowLeft size={16} />
          Tasks
        </Link>

        <div className="mt-6 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-[12px] text-ink-3">
              <TaskStatusIcon status={task.status} size={14} />
              {taskKey(task.number)}
              {!isOpenTask(task) ? <span>· {TASK_STATUS_META[task.status].label.toLowerCase()}</span> : null}
            </p>
            <div className="mt-3">
              <TaskEditor task={task} variant="page" />
            </div>
            {assignedAgent ? <AgentHandOff agent={assignedAgent} task={task} /> : null}
          </div>

          <aside className="flex flex-col rounded-[24px] border border-line bg-surface p-2 lg:sticky lg:top-6">
            <Property label="Status">
              <StatusMenu value={task.status} onChange={(status) => void actions.update(task, { status })} align="end">
                <FieldButton icon={<TaskStatusIcon status={task.status} />}>{TASK_STATUS_META[task.status].label}</FieldButton>
              </StatusMenu>
            </Property>
            <Property label="Priority">
              <PriorityMenu value={task.priority} onChange={(priority) => void actions.update(task, { priority })} align="end">
                <FieldButton icon={<PriorityIcon priority={task.priority} />}>{TASK_PRIORITY_META[task.priority].label}</FieldButton>
              </PriorityMenu>
            </Property>
            <Property label="Assignee">
              <AssigneePicker assigneeId={task.assigneeId} agentId={task.agentId} onChange={(choice) => void actions.update(task, choice)} align="end">
                <FieldButton icon={<TaskAssigneeAvatar task={task} size="xs" />}>{assigneeName ?? "Unassigned"}</FieldButton>
              </AssigneePicker>
            </Property>
            <Property label="Due">
              <DuePicker value={task.dueOn} onChange={(dueOn) => void actions.update(task, { dueOn })} align="end">
                <FieldButton icon={<IconCalendar size={15} />}>
                  {task.dueOn ? <DueLabel dueOn={task.dueOn} done={!isOpenTask(task)} /> : "No due date"}
                </FieldButton>
              </DuePicker>
            </Property>

            <div className="mx-2 my-2 h-px bg-line" />

            <Property label="Created">
              <span className="text-right text-[13px] text-ink-2">
                {creatorAgent ? `${creatorAgent.name} for ${creator === "You" ? "you" : creator}` : creator} ·{" "}
                <LocalTime iso={task.createdAt} format="list" />
              </span>
            </Property>
            {task.completedAt ? (
              <Property label="Finished">
                <LocalTime iso={task.completedAt} format="list" className="text-[13px] text-ink-2" />
              </Property>
            ) : null}
            {conversation ? (
              <Property label="Chat">
                <button
                  type="button"
                  onClick={() => void openConversation(conversation.id, task.messageId ?? undefined)}
                  className="inline-flex max-w-[170px] items-center gap-1.5 truncate text-[13px] font-medium text-ink underline-offset-2 hover:underline"
                >
                  <IconChat size={14} className="shrink-0 text-ink-3" />
                  <span className="truncate">{conversationTitle(conversation, members, me.id, agents)}</span>
                </button>
              </Property>
            ) : null}

            <div className="mx-2 mt-2 flex flex-wrap gap-1.5 border-t border-line pt-3">
              <Button size="sm" variant="ghost" onClick={() => void copyLink()}>
                <IconLink size={15} />
                Copy link
              </Button>
              {canDelete ? (
                <Button size="sm" variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
                  <IconTrash size={15} />
                  Delete
                </Button>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${taskKey(task.number)}?`}
        description="It’s removed for everyone. Messages that mention it stay in their chats."
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </div>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-2">
      <span className="text-[13px] text-ink-3">{label}</span>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

function AgentHandOff({ agent, task }: { agent: Agent; task: Task }) {
  const openConversation = useOpenConversation();
  const send = useSendToConversation();
  const actions = useTaskActions();
  const [starting, setStarting] = useState(false);
  const canUpdate = agent.tools.includes("tasks");

  async function start() {
    setStarting(true);
    try {
      const conversationId = await openAgentConversation(agent.id);
      await openConversation(conversationId);
      send(conversationId, handOffMessage(task));
      if (task.status === "todo") void actions.update(task, { status: "in_progress" });
    } catch (error) {
      toast.error(getErrorMessage(error, `Couldn't start ${agent.name}.`));
      setStarting(false);
    }
  }

  return (
    <section
      className="mt-8 flex flex-wrap items-center gap-4 rounded-[24px] border border-line bg-surface p-4 sm:flex-nowrap"
      style={personColorStyle(agent.color)}
    >
      <AgentAvatar agent={agent} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold text-ink">{agent.name} has this task</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">
          {canUpdate
            ? "It works on it in its chat with you, using your credits, and moves the task along as it goes."
            : "It works on it in its chat with you, using your credits. Turn on its task tool so it can update the task itself."}
        </p>
      </div>
      <Button onClick={() => void start()} loading={starting} disabled={!isOpenTask(task)}>
        Start work
      </Button>
    </section>
  );
}
