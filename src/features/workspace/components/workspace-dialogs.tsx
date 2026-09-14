"use client";

import { TaskDialog } from "@/features/tasks/components/task-dialog";

import { CommandPalette } from "./command-palette";
import { InviteDialog } from "./invite-dialog";
import { PeoplePickerDialog } from "./people-picker-dialog";
import { useWorkspace } from "../store/workspace-provider";

export function WorkspaceDialogs() {
  const dialog = useWorkspace((state) => state.dialog);
  const closeDialog = useWorkspace((state) => state.closeDialog);
  const onOpenChange = (open: boolean) => {
    if (!open) closeDialog();
  };

  return (
    <>
      <PeoplePickerDialog
        open={dialog?.name === "new-chat" || dialog?.name === "add-people"}
        onOpenChange={onOpenChange}
        conversationId={dialog?.name === "add-people" ? dialog.conversationId : undefined}
      />
      <InviteDialog open={dialog?.name === "invite"} onOpenChange={onOpenChange} />
      <CommandPalette open={dialog?.name === "palette"} onOpenChange={onOpenChange} />
      <TaskDialog
        open={dialog?.name === "task"}
        onOpenChange={onOpenChange}
        taskId={dialog?.name === "task" ? dialog.taskId : undefined}
        draft={dialog?.name === "task" ? dialog.draft : undefined}
      />
    </>
  );
}
