import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LAST_WORKSPACE_COOKIE } from "@/lib/constants";
import { routes } from "@/lib/routes";
import { getMyWorkspaces, getOwnProfile, requireAuthUser } from "@/server/session";

/** Sends everyone to the right place: setup, or the workspace they used last. */
export default async function HomePage() {
  const user = await requireAuthUser();
  const profile = await getOwnProfile(user.id);
  if (!profile?.fullName) redirect(routes.onboarding.profile);

  const workspaces = await getMyWorkspaces();
  if (workspaces.length === 0) redirect(routes.onboarding.workspace);

  const lastSlug = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  const target = workspaces.find((workspace) => workspace.slug === lastSlug) ?? workspaces[0];
  redirect(routes.workspace(target.slug));
}
