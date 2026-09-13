"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconCopy } from "@/components/ui/icons";
import { pluralize } from "@/lib/utils";

import type { InviteReport } from "../types";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Invite link copied.");
  } catch {
    toast.error("Couldn't copy. Select the link and copy it manually.");
  }
}

export function InviteReportView({ report }: { report: InviteReport }) {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {report.sent.length > 0 ? (
        <ReportRow tone="grass" title={`Invited ${pluralize(report.sent.length, "person", "people")}`}>
          {report.sent.join(", ")}
        </ReportRow>
      ) : null}

      {report.undelivered.length > 0 ? (
        <ReportRow tone="saffron" title="We couldn't email these. Share the link yourself.">
          <ul className="mt-2 flex flex-col gap-1.5">
            {report.undelivered.map((item) => (
              <li key={item.email} className="flex items-center justify-between gap-3">
                <span className="truncate">{item.email}</span>
                <Button variant="secondary" size="sm" onClick={() => copy(item.link)}>
                  <IconCopy size={14} />
                  Copy link
                </Button>
              </li>
            ))}
          </ul>
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

function ReportRow({ tone, title, children }: { tone: string; title: string; children: React.ReactNode }) {
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
