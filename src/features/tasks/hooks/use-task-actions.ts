"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { reportTaskEvent } from "@/features/integrations/api";
import { taskEventFor } from "@/features/integrations/lib/task-events";
import { useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { withRetry } from "@/lib/async/retry";
import { getErrorMessage } from "@/lib/errors";
import type { Task } from "@/types/domain";

import { createTask, deleteTask, updateTask, type NewTask, type TaskChanges } from "../api";

/** The task as it will look once the server accepts the change, for an instant update on screen. */
export function applyTaskChanges(task: Task, changes: TaskChanges, now = new Date().toISOString()): Task {
  const next: Task = { ...task, updatedAt: now };
  if (changes.title !== undefined) next.title = changes.title;
  if (changes.description !== undefined) next.description = changes.description;
  if (changes.priority !== undefined) next.priority = changes.priority;
  if (changes.dueOn !== undefined) next.dueOn = changes.dueOn;
  if (changes.assigneeId !== undefined) next.assigneeId = changes.assigneeId;
  if (changes.agentId !== undefined) next.agentId = changes.agentId;
  if (changes.assigneeId) next.agentId = null;
  if (changes.agentId) next.assigneeId = null;
  if (changes.status !== undefined) {
    next.status = changes.status;
    next.completedAt = changes.status === "done" ? (task.status === "done" ? task.completedAt : now) : null;
  }
  return next;
}

/**
 * Task changes show at once and roll back if the server refuses. A newer copy
 * that arrived in the meantime is never overwritten by the rollback. Saved
 * changes are reported to any apps the workspace connected.
 */
export function useTaskActions() {
  const store = useWorkspaceStore();

  return useMemo(() => {
    const state = () => store.getState();

    return {
      async create(input: NewTask) {
        const task = await createTask(state().workspace.id, input);
        state().upsertTask(task);
        reportTaskEvent(task.id, "task.created");
        return task;
      },

      async update(task: Task, changes: TaskChanges) {
        const before = state().tasks[task.id] ?? task;
        state().upsertTask(applyTaskChanges(before, changes));
        try {
          const saved = await withRetry(() => updateTask(task.id, changes));
          state().upsertTask(saved);
          const event = taskEventFor(before, saved);
          if (event) reportTaskEvent(saved.id, event);
          return saved;
        } catch (error) {
          state().upsertTask(before);
          toast.error(getErrorMessage(error, "Couldn't save that change."));
          return null;
        }
      },

      async remove(task: Task) {
        try {
          const removed = await deleteTask(task.id);
          state().removeTask(task.id);
          return removed;
        } catch (error) {
          toast.error(getErrorMessage(error, "Couldn't delete the task."));
          return false;
        }
      },
    };
  }, [store]);
}
