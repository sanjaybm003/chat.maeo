import { NextResponse, type NextRequest } from "next/server";

import {
  describeInstallation,
  exchangeOAuthCode,
  githubApp,
  GithubError,
  INSTALL_STATE_COOKIE,
  readInstallState,
  userCanUseInstallation,
} from "@/features/integrations/server/github";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { routes } from "@/lib/routes";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const log = logger.child({ module: "github-callback" });

/**
 * Where GitHub returns after the app is installed. Connects the installation
 * only when the state matches the admin who started, and GitHub confirms that
 * the same person can reach that installation.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const pinned = request.cookies.get(INSTALL_STATE_COOKIE)?.value ?? "";
  const installationId = params.get("installation_id") ?? "";
  const code = params.get("code");

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL(routes.login, request.url));

  const secret = githubApp.clientSecret;
  const decoded = secret && state && state === pinned ? readInstallState(secret, state) : null;
  if (!decoded || decoded.userId !== auth.user.id) {
    log.warn("GitHub callback with a missing or foreign state");
    return NextResponse.redirect(new URL(routes.home, request.url));
  }

  const { data: workspace } = await supabase.from("workspaces").select("slug").eq("id", decoded.workspaceId).maybeSingle();
  if (!workspace) return NextResponse.redirect(new URL(routes.home, request.url));

  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`${routes.settings(workspace.slug, "integrations")}?${query}`, request.url));
    response.cookies.delete({ name: INSTALL_STATE_COOKIE, path: "/api/integrations/github" });
    return response;
  };

  // An organization member without rights asked an owner to approve; nothing is installed yet.
  if (params.get("setup_action") === "request") return back("notice=github_requested");
  if (!/^\d{1,20}$/.test(installationId)) return back("error=github_incomplete");
  if (!code) return back("error=github_no_code");
  if (!serverEnv.hasServiceRoleKey) return back("error=github_unavailable");

  try {
    const userToken = await exchangeOAuthCode(code);
    if (!(await userCanUseInstallation(userToken, installationId))) return back("error=github_forbidden");
    const account = await describeInstallation(installationId);

    const { error } = await createSupabaseAdminClient().rpc("connect_workspace_integration", {
      p_user_id: auth.user.id,
      p_workspace_id: decoded.workspaceId,
      p_provider: "github",
      p_external_id: installationId,
      p_account_login: account.login,
      p_account_type: account.type,
    });
    if (error) {
      log.warn("connecting GitHub failed", { error });
      return back(error.code === "42501" ? "error=not_admin" : "error=github_failed");
    }
    return back("connected=github");
  } catch (error) {
    log.warn("GitHub installation check failed", { status: error instanceof GithubError ? error.status : undefined, error });
    return back("error=github_failed");
  }
}
