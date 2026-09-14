import { NextResponse, type NextRequest } from "next/server";

import { createInstallState, githubApp, INSTALL_STATE_COOKIE, installUrl } from "@/features/integrations/server/github";
import { routes } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sends a workspace admin to GitHub to install maeosan's app. The state that
 * comes back is signed and pinned to this browser, so the callback can only
 * connect the workspace this admin started from.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("workspace") ?? "";
  const back = (query: string) => NextResponse.redirect(new URL(`${routes.settings(slug, "integrations")}?${query}`, request.url));

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    return NextResponse.redirect(new URL(`${routes.login}?next=${encodeURIComponent(next)}`, request.url));
  }
  if (!slug) return NextResponse.redirect(new URL(routes.home, request.url));

  const secret = githubApp.clientSecret;
  if (!githubApp.configured || !secret) return back("error=github_unavailable");

  const { data: workspaces } = await supabase.rpc("my_workspaces");
  const workspace = (workspaces ?? []).find((item) => item.slug === slug);
  if (!workspace) return NextResponse.redirect(new URL(routes.home, request.url));
  if (workspace.role === "member") return back("error=not_admin");

  const state = createInstallState(secret, { workspaceId: workspace.id, userId: auth.user.id });
  const response = NextResponse.redirect(installUrl(state));
  response.cookies.set(INSTALL_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/github",
    maxAge: 600,
  });
  return response;
}
