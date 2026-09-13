"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { WorkspaceGlyph } from "@/components/brand/workspace-glyph";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/utils";
import type { PendingInvitation } from "@/types/domain";

import { acceptInvitation, declineInvitation } from "../actions";

export function PendingInviteCard({ invitation }: { invitation: PendingInvitation }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "joining" | "declining" | "declined">("idle");

  async function join() {
    setState("joining");
    const result = await acceptInvitation(invitation.token);
    if (!result.ok) {
      setState("idle");
      toast.error(result.error);
      return;
    }
    router.push(result.data.redirectTo);
  }

  async function decline() {
    setState("declining");
    const result = await declineInvitation(invitation.token);
    if (!result.ok) {
      setState("idle");
      toast.error(result.error);
      return;
    }
    setState("declined");
  }

  if (state === "declined") return null;

  return (
    <div className="flex animate-rise items-center gap-4 rounded-[22px] border border-line bg-surface p-4">
      <WorkspaceGlyph name={invitation.workspaceName} seed={invitation.workspaceSlug} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-semibold tracking-[-0.01em]">{invitation.workspaceName}</p>
        <p className="truncate text-[13px] text-ink-3">
          {invitation.inviterName} invited you · {pluralize(invitation.memberCount, "person", "people")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={decline} loading={state === "declining"} disabled={state === "joining"}>
          Decline
        </Button>
        <Button size="sm" onClick={join} loading={state === "joining"} disabled={state === "declining"}>
          Join
        </Button>
      </div>
    </div>
  );
}
