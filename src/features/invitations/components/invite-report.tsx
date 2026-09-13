"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconCopy } from "@/components/ui/icons";
import { useHydrated } from "@/hooks/use-hydrated";
import { isLocalHostname } from "@/lib/origin";
import { routes } from "@/lib/routes";
import { pluralize } from "@/lib/utils";

import { DELIVERY_ISSUE_REASON } from "../delivery-issues";
import type { InviteReport } from "../types";

/** Built in the browser, so the link always matches the address maeosan is open at. */
export function inviteLinkFor(token: string) {
  return `${window.location.origin}${routes.invite(token)}`;
}

async function copyInviteLink(token: string) {
  const link = inviteLinkFor(token);
  try {
    await navigator.clipboard.writeText(link);
    toast.success("Invite link copied.");
  } catch {
    // Clipboard access can be blocked; a prompt still lets people select and copy.
    window.prompt("Copy this invite link", link);
  }
}

export function InviteReportView({ report }: { report: InviteReport }) {
  const hydrated = useHydrated();
  const localOnly = hydrated && isLocalHostname(window.location.hostname);

  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {report.sent.length > 0 ? (
        <ReportRow tone="grass" title={`Invited ${pluralize(report.sent.length, "person", "people")}`}>
          {report.sent.join(", ")}
        </ReportRow>
      ) : null}

      {report.undelivered.length > 0 ? (
        <ReportRow tone="saffron" title="We couldn't email these. Share the link yourself.">
          <p>{DELIVERY_ISSUE_REASON[report.emailIssue ?? "failed"]}</p>
          {report.emailIssueDetail ? (
            <p className="mt-1 break-words font-mono text-[11.5px] text-ink-4">Details: {report.emailIssueDetail}</p>
          ) : null}
          <ul className="mt-2 flex flex-col gap-1.5">
            {report.undelivered.map((item) => (
              <li key={item.email} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink-2">{item.email}</span>
                <Button variant="secondary" size="sm" onClick={() => void copyInviteLink(item.token)}>
                  <IconCopy size={14} />
                  Copy link
                </Button>
              </li>
            ))}
          </ul>
          {localOnly ? (
            <p className="mt-2 text-[12.5px]">
              This link starts with {window.location.host}, so it only opens on this computer. To invite someone on another
              device, run maeosan at a public address.
            </p>
          ) : null}
        </ReportRow>
      ) : null}

      {report.alreadyMembers.length > 0 ? (
        <ReportRow tone="cobalt" title="Already in the workspace">
          {report.alreadyMembers.join(", ")}
        </ReportRow>
      ) : null}

      {report.invalid.length > 0 ? (
        <ReportRow tone="tomato" title="Not valid email addresses">
          {report.invalid.join(", ")}
        </ReportRow>
      ) : null}
    </div>
  );
}

function ReportRow({ tone, title, children }: { tone: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-surface p-3.5">
      <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--${tone})` }} />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-ink">{title}</p>
        <div className="mt-0.5 break-words text-ink-3">{children}</div>
      </div>
    </div>
  );
}
