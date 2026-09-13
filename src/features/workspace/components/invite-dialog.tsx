"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { inviteToWorkspace } from "@/features/invitations/actions";
import { EmailChipsInput, isValidEmail } from "@/features/invitations/components/email-chips-input";
import { InviteReportView } from "@/features/invitations/components/invite-report";
import type { InviteReport } from "@/features/invitations/types";
import { useServerAction } from "@/hooks/use-server-action";

import { useWorkspace } from "../store/workspace-provider";

export const INVITES_CHANGED_EVENT = "maeosan:invites-changed";

export function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const workspaceName = useWorkspace((state) => state.workspace.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Invite people to ${workspaceName}`}
        description="They’ll get an email with a link to join. Once they’re in, they appear in everyone’s contacts."
      >
        {open ? <InviteBody onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function InviteBody({ onDone }: { onDone: () => void }) {
  const workspace = useWorkspace((state) => state.workspace);
  const myRole = useWorkspace((state) => state.myRole);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<"member" | "admin">("member");
  const [report, setReport] = useState<InviteReport | null>(null);
  const action = useServerAction(inviteToWorkspace);

  const isAdmin = myRole !== "member";
  const canInvite = isAdmin || workspace.membersCanInvite;
  const validCount = emails.filter(isValidEmail).length;

  async function send() {
    const result = await action.run({ workspaceId: workspace.id, emails, role });
    if (result.ok) {
      setReport(result.data);
      setEmails([]);
      window.dispatchEvent(new Event(INVITES_CHANGED_EVENT));
    }
  }

  if (!canInvite) {
    return (
      <>
        <DialogBody>
          <p className="rounded-2xl border border-line bg-surface-2 p-4 text-sm text-ink-2">
            Only admins can invite people to {workspace.name}. Ask an admin to send the invite, or to let everyone invite in
            workspace settings.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onDone}>Got it</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <FormError message={action.error} />
        <EmailChipsInput value={emails} onChange={setEmails} autoFocus />
        {isAdmin ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-ink-3">Join as</span>
            <Segmented<"member" | "admin">
              size="sm"
              label="Role"
              value={role}
              onChange={setRole}
              options={[
                { value: "member", label: "Member" },
                { value: "admin", label: "Admin" },
              ]}
            />
          </div>
        ) : null}
        {report ? <InviteReportView report={report} /> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          {report ? "Done" : "Cancel"}
        </Button>
        <Button onClick={send} loading={action.pending} disabled={validCount === 0}>
          {validCount > 1 ? `Invite ${validCount} people` : "Send invite"}
        </Button>
      </DialogFooter>
    </>
  );
}
