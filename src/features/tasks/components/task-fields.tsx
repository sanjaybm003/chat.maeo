"use client";

import { Popover } from "radix-ui";
import { useId, useMemo, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconCalendar, IconCheck, IconSearch } from "@/components/ui/icons";
import { inputStyles } from "@/components/ui/input";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import { canUseAgent } from "@/features/ai/access";
import { AgentAvatar } from "@/features/ai/components/agent-avatar";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn, nameOf } from "@/lib/utils";
import { TASK_STATUSES, type Task, type TaskPriority, type TaskStatus } from "@/types/domain";

import { addDays, isoDate, nextWeekday, shortDate } from "../lib/dates";
import { describeDue, PRIORITY_ORDER, TASK_PRIORITY_META, TASK_STATUS_META } from "../lib/task-meta";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

const POPOVER =
  "z-50 max-h-[min(420px,70vh)] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-pop outline-none data-[state=open]:animate-pop-in";

/** A pill that opens a field's picker. Passes ref and Radix props straight to the button. */
export function FieldButton({ icon, children, className, ...props }: ComponentProps<"button"> & { icon?: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line-2 bg-surface px-3 text-[13px] text-ink-2 transition-colors",
        "hover:border-ink-4 hover:text-ink data-[state=open]:border-ink-4 data-[state=open]:text-ink disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

interface MenuFieldProps<T> {
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
  align?: "start" | "end";
}

export function StatusMenu({ value, onChange, children, align = "start" }: MenuFieldProps<TaskStatus>) {
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent align={align} className="min-w-[190px]">
        <MenuLabel>Status</MenuLabel>
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as TaskStatus)}>
          {TASK_STATUSES.map((status) => (
            <MenuRadioItem key={status} value={status}>
              <TaskStatusIcon status={status} />
              {TASK_STATUS_META[status].label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export function PriorityMenu({ value, onChange, children, align = "start" }: MenuFieldProps<TaskPriority>) {
  return (
    <Menu>
      <MenuTrigger asChild>{children}</MenuTrigger>
      <MenuContent align={align} className="min-w-[190px]">
        <MenuLabel>Priority</MenuLabel>
        <MenuRadioGroup value={value} onValueChange={(next) => onChange(next as TaskPriority)}>
          {PRIORITY_ORDER.map((priority) => (
            <MenuRadioItem key={priority} value={priority}>
              <PriorityIcon priority={priority} />
              {TASK_PRIORITY_META[priority].label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

export interface AssigneeChoice {
  assigneeId: string | null;
  agentId: string | null;
}

interface AssigneeOption {
  key: string;
  section: string;
  label: string;
  hint?: string;
  leading: ReactNode;
  choice: AssigneeChoice;
  selected: boolean;
}

export function AssigneePicker({
  assigneeId,
  agentId,
  onChange,
  children,
  align = "start",
}: AssigneeChoice & { onChange: (choice: AssigneeChoice) => void; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={12} className={cn(POPOVER, "w-[290px] p-0")}>
          {open ? (
            <AssigneeList
              assigneeId={assigneeId}
              agentId={agentId}
              onPick={(choice) => {
                setOpen(false);
                onChange(choice);
              }}
            />
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AssigneeList({ assigneeId, agentId, onPick }: AssigneeChoice & { onPick: (choice: AssigneeChoice) => void }) {
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const meId = useWorkspace((state) => state.me.id);
  const myRole = useWorkspace((state) => state.myRole);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const options = useMemo<AssigneeOption[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

    const people = Object.values(members)
      .filter((member) => matches(`${nameOf(member)} ${member.email} ${member.title ?? ""}`))
      .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : nameOf(a).localeCompare(nameOf(b))))
      .map((member) => ({
        key: member.id,
        section: "People",
        label: member.id === meId ? `${nameOf(member)} (you)` : nameOf(member),
        hint: member.title ?? undefined,
        leading: <Avatar person={member} size="xs" />,
        choice: { assigneeId: member.id, agentId: null },
        selected: assigneeId === member.id,
      }));

    const workers = Object.values(agents)
      // Only agents this person may give work to, plus the one already on the task.
      .filter((agent) => !agent.archivedAt && (agent.id === agentId || canUseAgent(agent, meId, myRole)) && matches(`${agent.name} ${agent.handle}`))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({
        key: agent.id,
        section: "Agents",
        label: agent.name,
        hint: `@${agent.handle}`,
        leading: <AgentAvatar agent={agent} size="xs" />,
        choice: { assigneeId: null, agentId: agent.id },
        selected: agentId === agent.id,
      }));

    const nobody = matches("unassigned nobody")
      ? [
          {
            key: "nobody",
            section: "",
            label: "Unassigned",
            leading: <span className="block size-5 rounded-full border border-dashed border-ink-4" />,
            choice: { assigneeId: null, agentId: null },
            selected: !assigneeId && !agentId,
          },
        ]
      : [];

    return [...nobody, ...people, ...workers];
  }, [members, agents, meId, myRole, query, assigneeId, agentId]);

  const current = Math.min(active, Math.max(options.length - 1, 0));

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + options.length) % Math.max(options.length, 1));
    } else if (event.key === "Enter" && options[current]) {
      event.preventDefault();
      onPick(options[current].choice);
    }
  }

  let lastSection = "";
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <IconSearch size={15} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Assign to…"
          aria-label="Search people and agents"
          aria-controls={listId}
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-4"
        />
      </div>
      <div id={listId} role="listbox" className="p-1.5">
        {options.length === 0 ? <p className="px-2.5 py-4 text-center text-[13px] text-ink-3">Nobody matches.</p> : null}
        {options.map((option, index) => {
          const header = option.section && option.section !== lastSection ? option.section : null;
          lastSection = option.section;
          return (
            <div key={option.key}>
              {header ? <p className="px-2.5 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">{header}</p> : null}
              <button
                type="button"
                role="option"
                aria-selected={index === current}
                onMouseMove={() => index !== current && setActive(index)}
                onClick={() => onPick(option.choice)}
                className={cn("flex h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left", index === current && "bg-paper-2")}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">{option.leading}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{option.label}</span>
                </span>
                {option.hint ? <span className="max-w-[90px] shrink-0 truncate font-mono text-[10.5px] text-ink-4">{option.hint}</span> : null}
                {option.selected ? <IconCheck size={15} className="shrink-0 text-ink" /> : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DuePicker({
  value,
  onChange,
  children,
  align = "start",
}: {
  value: string | null;
  onChange: (dueOn: string | null) => void;
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const pick = (dueOn: string | null) => {
    setOpen(false);
    onChange(dueOn);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} collisionPadding={12} className={cn(POPOVER, "w-[250px]")}>
          {open ? <DueChoices value={value} onPick={pick} /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DueChoices({ value, onPick }: { value: string | null; onPick: (dueOn: string | null) => void }) {
  const inputId = useId();
  const today = new Date();
  const todayIso = isoDate(today);
  const choices = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: today.getDay() === 5 ? "Next Friday" : "Friday", date: nextWeekday(today, 5) },
    { label: "Next Monday", date: nextWeekday(today, 1) },
    { label: "In a week", date: addDays(today, 7) },
  ];

  return (
    <div className="flex flex-col">
      {choices.map((choice) => {
        const iso = isoDate(choice.date);
        return (
          <button
            key={choice.label}
            type="button"
            onClick={() => onPick(iso)}
            className="flex h-9 items-center justify-between gap-3 rounded-xl px-2.5 text-left text-[14px] text-ink hover:bg-paper-2"
          >
            <span>{choice.label}</span>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
              {shortDate(iso, todayIso)}
              {value === iso ? <IconCheck size={13} className="text-ink" /> : null}
            </span>
          </button>
        );
      })}
      <div className="-mx-1.5 my-1.5 h-px bg-line" />
      <label htmlFor={inputId} className="px-2.5 pb-1.5 pt-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
        Pick a date
      </label>
      <input
        id={inputId}
        type="date"
        defaultValue={value ?? ""}
        onChange={(event) => {
          if (event.target.value) onPick(event.target.value);
        }}
        className={cn(inputStyles, "h-10 text-[14px]")}
      />
      {value ? (
        <button type="button" onClick={() => onPick(null)} className="mt-1.5 h-9 rounded-xl px-2.5 text-left text-[14px] text-danger hover:bg-danger-tint">
          Remove due date
        </button>
      ) : null}
    </div>
  );
}

/** "Today", "3 days late", "Friday": relative once the browser's calendar is known. */
export function DueLabel({ dueOn, done = false, withIcon = false, className }: { dueOn: string; done?: boolean; withIcon?: boolean; className?: string }) {
  const hydrated = useHydrated();
  const due = hydrated ? describeDue(dueOn, isoDate(new Date())) : { label: shortDate(dueOn, dueOn), tone: "later" as const };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        done ? "text-ink-4" : due.tone === "overdue" ? "text-danger" : due.tone === "today" ? "font-medium text-ink" : "text-ink-3",
        className,
      )}
    >
      {withIcon ? <IconCalendar size={13} /> : null}
      {due.label}
    </span>
  );
}

export function TaskAssigneeAvatar({ task, size = "sm" }: { task: Pick<Task, "assigneeId" | "agentId">; size?: "xs" | "sm" }) {
  const member = useWorkspace((state) => (task.assigneeId ? (state.members[task.assigneeId] ?? null) : null));
  const agent = useWorkspace((state) => (task.agentId ? (state.agents[task.agentId] ?? null) : null));
  if (task.agentId) return <AgentAvatar agent={agent} size={size} />;
  if (task.assigneeId) return <Avatar person={member} size={size} />;
  return <span className={cn("block shrink-0 rounded-full border border-dashed border-ink-4", size === "xs" ? "size-5" : "size-7")} aria-hidden="true" />;
}

/** "You", a teammate's name, an agent's name, or null when nobody has it. */
export function useAssigneeName(task: Pick<Task, "assigneeId" | "agentId">) {
  return useWorkspace((state) => {
    if (task.agentId) return state.agents[task.agentId]?.name ?? "An agent";
    if (task.assigneeId) return task.assigneeId === state.me.id ? "You" : nameOf(state.members[task.assigneeId]);
    return null;
  });
}
