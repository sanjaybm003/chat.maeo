"use client";

import Link from "next/link";
import { useState, type DragEvent } from "react";

import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types/domain";

import { useTaskActions } from "../hooks/use-task-actions";
import { compareTasks, isOpenTask, TASK_STATUS_META, taskKey } from "../lib/task-meta";
import { DueLabel, StatusMenu, TaskAssigneeAvatar } from "./task-fields";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

const COLUMNS: readonly TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
/** Finished work piles up; the board shows the most recent and says how many more. */
const DONE_SHOWN = 20;
const DRAG_TYPE = "application/x-maeosan-task";

/**
 * Tasks as columns by status. Drag a card to another column to move it, or use
 * the status button on the card, which also works from the keyboard.
 */
export function TaskBoard({ tasks }: { tasks: readonly Task[] }) {
  const actions = useTaskActions();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  function drop(event: DragEvent<HTMLElement>, status: TaskStatus) {
    event.preventDefault();
    const id = event.dataTransfer.getData(DRAG_TYPE) || dragging;
    setOver(null);
    setDragging(null);
    const task = tasks.find((item) => item.id === id);
    if (task && task.status !== status) void actions.update(task, { status });
  }

  let cardIndex = 0;

  return (
    <div className="-mx-5 overflow-x-auto px-5 pb-3 sm:-mx-10 sm:px-10">
      <div className="grid snap-x snap-mandatory auto-cols-[minmax(248px,1fr)] grid-flow-col gap-3">
        {COLUMNS.map((status) => {
          const all = tasks.filter((task) => task.status === status).sort(compareTasks);
          const shown = status === "done" ? all.slice(0, DONE_SHOWN) : all;
          const label = TASK_STATUS_META[status].label;
          return (
            <section
              key={status}
              aria-label={`${label}, ${all.length} ${all.length === 1 ? "task" : "tasks"}`}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (over !== status) setOver(status);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(event) => drop(event, status)}
              className={cn(
                "flex min-h-[340px] snap-start flex-col rounded-[22px] border p-2 transition-colors duration-150",
                over === status
                  ? "border-ink-4 bg-paper-2"
                  : "border-line bg-[color-mix(in_srgb,var(--paper-2)_55%,transparent)]",
              )}
            >
              <header className="flex items-center gap-2 px-2 pb-2.5 pt-1.5">
                <TaskStatusIcon status={status} size={14} />
                <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
                <span className="font-mono text-[11px] text-ink-4">{all.length}</span>
              </header>
              <ul className="flex flex-1 flex-col gap-2">
                {shown.map((task) => (
                  <BoardCard
                    key={task.id}
                    task={task}
                    index={cardIndex++}
                    dragging={dragging === task.id}
                    onDragStart={setDragging}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  />
                ))}
                {all.length === 0 ? (
                  <li className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-line-2 px-3 py-8 text-center text-[12.5px] text-ink-4">
                    {dragging ? `Drop here for ${label.toLowerCase()}` : "Nothing here"}
                  </li>
                ) : null}
              </ul>
              {all.length > shown.length ? (
                <p className="px-2 pt-2.5 text-[12px] text-ink-3">{all.length - shown.length} more finished</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface BoardCardProps {
  task: Task;
  index: number;
  dragging: boolean;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}

function BoardCard({ task, index, dragging, onDragStart, onDragEnd }: BoardCardProps) {
  const slug = useWorkspace((state) => state.workspace.slug);
  const actions = useTaskActions();
  const open = isOpenTask(task);

  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, task.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart(task.id);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group animate-rise cursor-grab rounded-2xl border border-line bg-surface p-3 transition-[border-color,opacity] duration-150 hover:border-line-2 active:cursor-grabbing",
        dragging && "opacity-40",
      )}
      style={{ animationDelay: `${Math.min(index, 16) * 20}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-3">{taskKey(task.number)}</span>
        {task.priority !== "none" ? <PriorityIcon priority={task.priority} size={13} /> : null}
        <span className="ml-auto -my-1 -mr-1">
          <StatusMenu value={task.status} onChange={(status) => void actions.update(task, { status })} align="end">
            <button
              type="button"
              aria-label={`${TASK_STATUS_META[task.status].label}. Move ${taskKey(task.number)}`}
              className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-paper-2 data-[state=open]:bg-paper-2"
            >
              <TaskStatusIcon status={task.status} size={15} />
            </button>
          </StatusMenu>
        </span>
      </div>
      <Link
        href={routes.task(slug, task.number)}
        draggable={false}
        className={cn(
          "mt-1.5 line-clamp-3 block text-[14px] leading-snug text-ink underline-offset-2 hover:underline",
          !open && "text-ink-3 line-through decoration-ink-4",
        )}
      >
        {task.title}
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2 [--avatar-ring:var(--surface)]">
        <span className="min-w-0 truncate text-[12px]">
          {task.dueOn ? <DueLabel dueOn={task.dueOn} done={!open} withIcon /> : <span className="text-ink-4">No due date</span>}
        </span>
        <TaskAssigneeAvatar task={task} />
      </div>
    </li>
  );
}
