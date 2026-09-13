"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { inviteToWorkspace } from "@/features/invitations/actions";
import { EmailChipsInput, isValidEmail } from "@/features/invitations/components/email-chips-input";
import { InviteReportView } from "@/features/invitations/components/invite-report";
import type { InviteReport } from "@/features/invitations/types";
import { useServerAction } from "@/hooks/use-server-action";

import { completeOnboarding } from "../actions";

export function InviteStepForm({ workspaceId, slug }: { workspaceId: string; slug: string }) {
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>([]);
  const [report, setReport] = useState<InviteReport | null>(null);
  const invite = useServerAction(inviteToWorkspace);
  const finish = useServerAction(completeOnboarding);
  const [leaving, setLeaving] = useState(false);

  const validCount = emails.filter(isValidEmail).length;

  async function sendInvites() {
    const result = await invite.run({ workspaceId, emails, role: "member" });
    if (result.ok) {
      setReport(result.data);
      setEmails([]);
    }
  }

  async function goToWorkspace() {
    const result = await finish.run(slug);
    if (result.ok) {
      setLeaving(true);
      router.replace(result.data.redirectTo);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <FormError message={invite.error ?? finish.error} />

      <div className="flex flex-col gap-2">
        <label htmlFor="inviteEmails" className="text-[13px] font-medium text-ink-2">
          Email addresses
        </label>
        <EmailChipsInput id="inviteEmails" value={emails} onChange={setEmails} autoFocus />
        <p className="text-[13px] text-ink-3">Paste a whole list if you like. Everyone joins as a member.</p>
      </div>

      {report ? <InviteReportView report={report} /> : null}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        {validCount > 0 || !report ? (
          <Button size="lg" onClick={sendInvites} loading={invite.pending} disabled={validCount === 0}>
            {validCount > 1 ? `Invite ${validCount} people` : "Send invite"}
          </Button>
        ) : null}
        <Button
          size="lg"
          variant={report && validCount === 0 ? "primary" : "ghost"}
          onClick={goToWorkspace}
          loading={finish.pending || leaving}
          disabled={invite.pending}
        >
          {report ? "Open maeosan" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}
