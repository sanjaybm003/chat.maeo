import Link from "next/link";
import { redirect } from "next/navigation";

import { SectionLabel } from "@/components/ui/field";
import { PendingInviteCard } from "@/features/invitations/components/pending-invite-card";
import { CreateWorkspaceForm } from "@/features/onboarding/components/create-workspace-form";
import { OnboardingFrame } from "@/features/onboarding/components/onboarding-frame";
import { routes } from "@/lib/routes";
import { getMyPendingInvitations, getMyWorkspaces, getOwnProfile, requireAuthUser } from "@/server/session";

export default async function OnboardingWorkspacePage() {
  const user = await requireAuthUser(routes.onboarding.workspace);
  const profile = await getOwnProfile(user.id);
  if (!profile?.fullName) redirect(routes.onboarding.profile);

  const [invitations, workspaces] = await Promise.all([getMyPendingInvitations(), getMyWorkspaces()]);
  const hasInvites = invitations.length > 0;

  return (
    <OnboardingFrame
      step={2}
      title={hasInvites ? "Your team is waiting." : "Make a home for your team."}
      description={
        hasInvites
          ? "Join the workspace you were invited to, or start a new one of your own."
          : "A workspace is where your people live. One per company is usually right."
      }
    >
      {hasInvites ? (
        <div className="mb-12 flex flex-col gap-3">
          <SectionLabel className="mb-1">Invitations for {user.email}</SectionLabel>
          {invitations.map((invitation) => (
            <PendingInviteCard key={invitation.token} invitation={invitation} />
          ))}
        </div>
      ) : null}

      {hasInvites ? <SectionLabel className="mb-6">Or create a new workspace</SectionLabel> : null}
      <CreateWorkspaceForm />

      {workspaces.length > 0 ? (
        <p className="mt-10 text-sm text-ink-3">
          Changed your mind?{" "}
          <Link href={routes.home} className="font-medium text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
            Back to your workspaces
          </Link>
        </p>
      ) : null}
    </OnboardingFrame>
  );
}
