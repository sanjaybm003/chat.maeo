import { redirect } from "next/navigation";

import { InviteStepForm } from "@/features/onboarding/components/invite-step-form";
import { OnboardingFrame } from "@/features/onboarding/components/onboarding-frame";
import { routes } from "@/lib/routes";
import { getMyWorkspaces, requireAuthUser } from "@/server/session";

export default async function OnboardingInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuthUser(routes.onboarding.workspace);
  const { workspace: slug } = await searchParams;
  const workspaces = await getMyWorkspaces();
  const workspace = workspaces.find((item) => item.slug === slug);
  if (!workspace) redirect(routes.home);

  return (
    <OnboardingFrame
      step={3}
      title="Bring your people."
      description={`${workspace.name} is ready. Invite the people you talk to every day. They’ll show up as contacts the moment they join.`}
    >
      <InviteStepForm workspaceId={workspace.id} slug={workspace.slug} />
    </OnboardingFrame>
  );
}
