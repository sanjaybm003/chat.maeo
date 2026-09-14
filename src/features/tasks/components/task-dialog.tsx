"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { IconCalendar, IconChat, IconClose } from "@/components/ui/icons";
import { Textarea } from "@/components/ui/input";
import { conversationTitle } from "@/features/chat/lib/conversation-meta";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { firstNameOf } from "@/lib/utils";
import type { TaskDraft, TaskPriority, TaskStatus } from "@/types/domain";

import { useTaskActions } from "../hooks/use-task-actions";
import { isoDate } from "../lib/dates";
import { parseQuickTask } from "../lib/quick-task";
import { describeDue, TASK_PRIORITY_META, TASK_STATUS_META, taskKey } from "../lib/task-meta";
import { TaskEditor } from "./task-editor";
import { AssigneePicker, DueLabel, DuePicker, FieldButton, PriorityMenu, StatusMenu, TaskAssigneeAvatar, type AssigneeChoice } from "./task-fields";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

export function TaskDialog({
  open,
  onOpenChange,
  taskId,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  draft?: TaskDraft;
}) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? taskId ? <EditTask key={taskId} taskId={taskId} onClose={close} /> : <NewTask draft={draft ?? {}} onClose={close} /> : null}
    </Dialog>
  );
}

function EditTask({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useWorkspace((state) => state.tasks[taskId]);
  const slug = useWorkspace((state) => state.workspace.slug);

  if (!task) {
    return (
      <DialogContent title="This task is gone" description="It was deleted, or you no longer have access to it." width="sm">
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent title={<span className="font-mono text-[14px] font-medium tracking-normal text-ink-3">{taskKey(task.number)}</span>} width="lg">
      <DialogBody className="pt-3">
        <TaskEditor task={task} variant="dialog" />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" asChild>
          <Link href={routes.task(slug, task.number)} onClick={onClose}>
            Open full page
          </Link>
        </Button>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function NewTask({ draft, onClose }: { draft: TaskDraft; onClose: () => void }) {
  const router = useRouter();
  const workspace = useWorkspace((state) => state.workspace);
  const me = useWorkspace((state) => state.me);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const conversations = useWorkspace((state) => state.conversations);
  const actions = useTaskActions();

  const [title, setTitle] = useState(draft.title ?? "");
  const [description, setDescription] = useState(draft.description ?? "");
  const [status, setStatus] = useState<TaskStatus>("todo");
  // Null or undefined means "not chosen here", so what the title says applies.
  const [priority, setPriority] = useState<TaskPriority | null>(draft.priority ?? null);
  const [assignee, setAssignee] = useState<AssigneeChoice | null>(
    draft.assigneeId !== undefined || draft.agentId !== undefined ? { assigneeId: draft.assigneeId ?? null, agentId: draft.agentId ?? null } : null,
  );
  const [dueOn, setDueOn] = useState<string | null | undefined>(draft.dueOn);
  const [conversationId, setConversationId] = useState(draft.conversationId ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directory = useMemo(() => ({ members: Object.values(members), agents: Object.values(agents) }), [members, agents]);
  const parsed = useMemo(() => parseQuickTask(title, directory), [title, directory]);

  const effective = {
    priority: priority ?? parsed.priority ?? "none",
    assigneeId: assignee ? assignee.assigneeId : parsed.assignee?.kind === "person" ? parsed.assignee.id : null,
    agentId: assignee ? assignee.agentId : parsed.assignee?.kind === "agent" ? parsed.assignee.id : null,
    dueOn: dueOn !== undefined ? dueOn : parsed.dueOn,
  };
  const assigneeName = effective.agentId
    ? (agents[effective.agentId]?.name ?? "An agent")
    : effective.assigneeId
      ? effective.assigneeId === me.id
        ? "You"
        : firstNameOf(members[effective.assigneeId])
      : null;
  const conversation = conversationId ? conversations[conversationId] : undefined;

  const detected = [
    !assignee && parsed.assignee ? `for ${assigneeName}` : null,
    dueOn === undefined && parsed.dueOn ? `due ${describeDue(parsed.dueOn, isoDate(new Date())).label.toLowerCase()}` : null,
    priority === null && parsed.priority ? TASK_PRIORITY_META[parsed.priority].label.toLowerCase() : null,
  ].filter(Boolean);

  async function submit() {
    if (saving) return;
    if (!parsed.title) {
      setError("Give the task a title.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const task = await actions.create({
        title: parsed.title.slice(0, 200),
        description: description.trim(),
        status,
        priority: effective.priority,
        assigneeId: effective.assigneeId,
        agentId: effective.agentId,
        dueOn: effective.dueOn,
        conversationId,
        messageId: conversationId && conversationId === draft.conversationId ? (draft.messageId ?? null) : null,
      });
      toast.success(`${taskKey(task.number)} created`, {
        description: task.title,
        action: { label: "Open", onClick: () => router.push(routes.task(workspace.slug, task.number)) },
      });
      onClose();
    } catch (cause) {
      setError(getErrorMessage(cause, "Couldn't create the task."));
      setSaving(false);
    }
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <DialogContent title="New task" width="lg">
      <DialogBody className="pt-3">
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleTitleKeyDown}
          maxLength={300}
          placeholder="What needs doing?"
          aria-label="Task title"
          className="w-full bg-transparent font-display text-[22px] font-semibold tracking-[-0.02em] text-ink outline-none placeholder:text-ink-4"
        />
        <p className="mt-1 min-h-4 font-mono text-[11px] text-ink-3">
          {parsed.unknownMention
            ? `@${parsed.unknownMention} isn’t in this workspace`
            : detected.length > 0
              ? `Understood: ${detected.join(" · ")}`
              : "Type @name, a day like friday, or !high to fill the details in"}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusMenu value={status} onChange={setStatus}>
            <FieldButton icon={<TaskStatusIcon status={status} />}>{TASK_STATUS_META[status].label}</FieldButton>
          </StatusMenu>
          <PriorityMenu value={effective.priority} onChange={setPriority}>
            <FieldButton icon={<PriorityIcon priority={effective.priority} />}>{TASK_PRIORITY_META[effective.priority].label}</FieldButton>
          </PriorityMenu>
          <AssigneePicker assigneeId={effective.assigneeId} agentId={effective.agentId} onChange={setAssignee}>
            <FieldButton icon={<TaskAssigneeAvatar task={effective} size="xs" />}>{assigneeName ?? "Assignee"}</FieldButton>
          </AssigneePicker>
          <DuePicker value={effective.dueOn} onChange={setDueOn}>
            <FieldButton icon={<IconCalendar size={15} />}>{effective.dueOn ? <DueLabel dueOn={effective.dueOn} /> : "Due date"}</FieldButton>
          </DuePicker>
        </div>

        <Textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={8000}
          placeholder="Add details, links, or what done looks like"
          aria-label="Task description"
          className="mt-4 text-[14.5px]"
        />

        {conversation ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-[13px] text-ink-2">
            <IconChat size={15} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">
              Shared in <span className="font-medium text-ink">{conversationTitle(conversation, members, me.id, agents)}</span>
            </span>
            <button
              type="button"
              onClick={() => setConversationId(null)}
              className="flex size-6 items-center justify-center rounded-full text-ink-3 hover:bg-paper-2 hover:text-ink"
              aria-label="Don’t share it in this chat"
            >
              <IconClose size={13} />
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4">
            <FormError message={error} />
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <span className="mr-auto hidden font-mono text-[11px] text-ink-4 sm:inline">enter to create</span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} loading={saving}>
          Create task
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
