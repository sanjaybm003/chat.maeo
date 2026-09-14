"use client";

import { useEffect, useState } from "react";

import { LocalTime } from "@/components/ui/local-time";
import { AgentAvatar } from "@/features/ai/components/agent-avatar";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { cn, firstNameOf } from "@/lib/utils";
import type { Message } from "@/types/domain";

import { fetchTask } from "../api";
import { useTaskActions } from "../hooks/use-task-actions";
import { isOpenTask, TASK_PRIORITY_META, taskKey } from "../lib/task-meta";
import { DueLabel, TaskAssigneeAvatar, useAssigneeName } from "./task-fields";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

/**
 * A task as it appears in the chat it was made in: always its live state, so
 * ticking it off here or anywhere else shows the same thing to everyone.
 */
export function TaskCard({ message }: { message: Message }) {
  const store = useWorkspaceStore();
  const taskId = message.meta.task_id;
  const task = useWorkspace((state) => (taskId ? state.tasks[taskId] : undefined));
  const tasksReady = useWorkspace((state) => state.tasksReady);
  const meId = useWorkspace((state) => state.me.id);
  const actor = useWorkspace((state) => (message.senderId ? state.members[message.senderId] : null));
  const agent = useWorkspace((state) => (message.meta.agent_id ? state.agents[message.meta.agent_id] : null));
  const openDialog = useWorkspace((state) => state.openDialog);
  const actions = useTaskActions();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!taskId || task || !tasksReady) return;
    let cancelled = false;
    fetchTask(taskId)
      .then((found) => {
        if (cancelled) return;
        if (found) store.getState().upsertTask(found);
        else setMissing(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [taskId, task, tasksReady, store]);

  const who = message.senderId === meId ? "You" : firstNameOf(actor, "Someone");
  const key = taskKey(task?.number ?? message.meta.number ?? 0);
  const title = task?.title ?? message.meta.name ?? "a task";

  if (message.meta.event === "task_completed" || !taskId) {
    return (
      <p className="my-3 flex items-center justify-center gap-2 text-center text-[12.5px] text-ink-3">
        <TaskStatusIcon status="done" size={14} />
        <span>
          {who} finished {key} · {title}
          <span className="text-ink-4">
            {" "}
            · <LocalTime iso={message.createdAt} />
          </span>
        </span>
      </p>
    );
  }

  const caption = agent ? `${agent.name} made ${key} for ${who === "You" ? "you" : who}` : `${who} made ${key}`;

  return (
    <div className="my-4 flex flex-col items-center gap-1.5 [--avatar-ring:var(--surface)]">
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        {agent ? <AgentAvatar agent={agent} size="xs" className="animate-agent-land" /> : null}
        {caption}
        <span className="text-ink-4">
          · <LocalTime iso={message.createdAt} />
        </span>
      </p>
      {task ? (
        <div className="flex w-full max-w-[520px] animate-rise items-start gap-2 rounded-[20px] border border-line bg-surface py-2.5 pl-2 pr-3">
          <button
            type="button"
            onClick={() => void actions.update(task, { status: isOpenTask(task) ? "done" : "todo" })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-paper-2"
            aria-label={isOpenTask(task) ? `Mark ${key} done` : `Reopen ${key}`}
          >
            <TaskStatusIcon status={task.status} size={18} className="transition-transform duration-200 active:scale-90" />
          </button>
          <button type="button" onClick={() => openDialog({ name: "task", taskId: task.id })} className="min-w-0 flex-1 py-1 text-left">
            <span className={cn("block text-[14.5px] font-medium leading-snug text-ink", !isOpenTask(task) && "text-ink-3 line-through decoration-ink-4")}>
              {task.title}
            </span>
            <TaskFacts taskId={task.id} />
          </button>
          <span className="pt-1">
            <TaskAssigneeAvatar task={task} />
          </span>
        </div>
      ) : (
        <p className="rounded-[20px] border border-dashed border-line-2 px-4 py-2.5 text-[13px] text-ink-3">
          {missing ? `${key} was deleted.` : title}
        </p>
      )}
    </div>
  );
}

function TaskFacts({ taskId }: { taskId: string }) {
  const task = useWorkspace((state) => state.tasks[taskId]);
  const assigneeName = useAssigneeName(task ?? { assigneeId: null, agentId: null });
  if (!task) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-3">
      <span className="font-mono">{taskKey(task.number)}</span>
      {task.priority !== "none" ? (
        <span className="inline-flex items-center gap-1">
          <PriorityIcon priority={task.priority} size={13} />
          {TASK_PRIORITY_META[task.priority].label}
        </span>
      ) : null}
      {task.dueOn ? <DueLabel dueOn={task.dueOn} done={!isOpenTask(task)} withIcon /> : null}
      <span>{assigneeName ?? "Unassigned"}</span>
    </span>
  );
}
