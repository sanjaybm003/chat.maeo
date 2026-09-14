"use client";

import { useEffect, useRef, useState } from "react";

import { IconCalendar } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Task } from "@/types/domain";

import type { TaskChanges } from "../api";
import { useTaskActions } from "../hooks/use-task-actions";
import { isOpenTask, TASK_PRIORITY_META, TASK_STATUS_META } from "../lib/task-meta";
import { AssigneePicker, DueLabel, DuePicker, FieldButton, PriorityMenu, StatusMenu, TaskAssigneeAvatar, useAssigneeName } from "./task-fields";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

/**
 * Title and description edited in place. Changes save when a field loses
 * focus, and anything still being typed is saved if the editor closes.
 */
export function TaskEditor({ task, variant }: { task: Task; variant: "dialog" | "page" }) {
  const actions = useTaskActions();
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  const pending = useRef({ task, title, description, actions });
  useEffect(() => {
    pending.current = { task, title, description, actions };
  });

  useEffect(
    () => () => {
      const { task: latest, title: typedTitle, description: typedDescription, actions: save } = pending.current;
      const changes = changesFrom(latest, typedTitle, typedDescription);
      if (changes) void save.update(latest, changes);
    },
    [],
  );

  function commit(next: { title?: string | null; description?: string | null }) {
    const changes = changesFrom(task, next.title ?? null, next.description ?? null);
    if (changes) void actions.update(task, changes);
  }

  return (
    <div className="flex flex-col">
      <textarea
        value={title ?? task.title}
        onFocus={() => setTitle(task.title)}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
        onBlur={() => {
          commit({ title });
          setTitle(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        rows={1}
        maxLength={200}
        aria-label="Task title"
        className={cn(
          "w-full resize-none bg-transparent font-display font-semibold tracking-[-0.02em] text-ink outline-none [field-sizing:content]",
          variant === "page" ? "text-[32px] leading-[1.15] sm:text-[36px]" : "text-[22px] leading-snug",
          !isOpenTask(task) && "text-ink-3",
        )}
      />

      {variant === "dialog" ? <TaskFieldsRow task={task} className="mt-3" /> : null}

      <Textarea
        value={description ?? task.description}
        onFocus={() => setDescription(task.description)}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          commit({ description });
          setDescription(null);
        }}
        rows={variant === "page" ? 10 : 5}
        maxLength={8000}
        placeholder="Add details, links, or what done looks like"
        aria-label="Task description"
        className={cn("mt-5 text-[14.5px] [field-sizing:content]", variant === "page" ? "min-h-[220px]" : "min-h-[120px]")}
      />
    </div>
  );
}

function changesFrom(task: Task, title: string | null, description: string | null): TaskChanges | null {
  const changes: TaskChanges = {};
  const cleanTitle = title?.replace(/\s+/g, " ").trim().slice(0, 200);
  if (cleanTitle && cleanTitle !== task.title) changes.title = cleanTitle;
  const cleanDescription = description?.trim().slice(0, 8000);
  if (cleanDescription !== undefined && cleanDescription !== task.description) changes.description = cleanDescription;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Status, priority, assignee and due date as a row of pills, each saving the moment it changes. */
export function TaskFieldsRow({ task, className }: { task: Task; className?: string }) {
  const actions = useTaskActions();
  const assigneeName = useAssigneeName(task);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <StatusMenu value={task.status} onChange={(status) => void actions.update(task, { status })}>
        <FieldButton icon={<TaskStatusIcon status={task.status} />}>{TASK_STATUS_META[task.status].label}</FieldButton>
      </StatusMenu>
      <PriorityMenu value={task.priority} onChange={(priority) => void actions.update(task, { priority })}>
        <FieldButton icon={<PriorityIcon priority={task.priority} />}>{TASK_PRIORITY_META[task.priority].label}</FieldButton>
      </PriorityMenu>
      <AssigneePicker assigneeId={task.assigneeId} agentId={task.agentId} onChange={(choice) => void actions.update(task, choice)}>
        <FieldButton icon={<TaskAssigneeAvatar task={task} size="xs" />}>{assigneeName ?? "Unassigned"}</FieldButton>
      </AssigneePicker>
      <DuePicker value={task.dueOn} onChange={(dueOn) => void actions.update(task, { dueOn })}>
        <FieldButton icon={<IconCalendar size={15} />}>
          {task.dueOn ? <DueLabel dueOn={task.dueOn} done={!isOpenTask(task)} /> : "Due date"}
        </FieldButton>
      </DuePicker>
    </div>
  );
}
