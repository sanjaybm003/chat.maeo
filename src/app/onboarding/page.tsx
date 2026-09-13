import { redirect } from "next/navigation";

import { OnboardingFrame } from "@/features/onboarding/components/onboarding-frame";
import { ProfileStepForm } from "@/features/onboarding/components/profile-step-form";
import { routes, safeNextPath } from "@/lib/routes";
import { getOwnProfile, needsPassword, requireAuthUser } from "@/server/session";

export default async function OnboardingProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuthUser(routes.onboarding.profile);
  const profile = await getOwnProfile(user.id);
  if (!profile) redirect(`${routes.login}?error=session`);

  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNextPath(params.next) : undefined;
  const metadataName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;

  return (
    <OnboardingFrame
      step={1}
      title="First, you."
      description="This is how you’ll show up to everyone in your workspace: in their contacts, their chats, their notifications."
    >
      <ProfileStepForm
        profile={profile}
        suggestedName={metadataName}
        requirePassword={needsPassword(user)}
        next={next && next !== routes.home ? next : undefined}
      />
    </OnboardingFrame>
  );
}
