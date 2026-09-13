import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { routes, safeNextPath } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/** Expired, already used, or replaced by a newer email. */
const isExpiredCode = (code: string | null | undefined) => code === "otp_expired" || code === "flow_state_expired";

/**
 * Lands every auth link and OAuth redirect:
 *   ?code=…                PKCE (OAuth, links opened in the same browser)
 *   ?token_hash=…&type=…   email templates using {{ .TokenHash }} (any browser)
 *   #access_token=…        implicit links (admin invites), finished client-side
 *   ?error=…               Supabase rejected the link before it reached us
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = process.env.NEXT_PUBLIC_SITE_URL ? env.siteUrl : request.nextUrl.origin;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const to = (path: string) => NextResponse.redirect(new URL(path, origin));
  const toLogin = (notice: string) => to(`${routes.login}?error=${notice}`);

  if (searchParams.get("error")) {
    const errorCode = searchParams.get("error_code");
    logger.info("auth link rejected by Supabase", { errorCode });
    return toLogin(isExpiredCode(errorCode) ? "link_expired" : "oauth");
  }

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return to(next);

    logger.info("auth code exchange failed", { code: error.code });
    // Supabase already verified the email; this browser just never started the
    // flow, so it holds no PKCE verifier. Usually a link opened elsewhere.
    if (error.code === "pkce_code_verifier_not_found") return toLogin("other_browser");
    return toLogin(isExpiredCode(error.code) ? "link_expired" : "link");
  }

  if (tokenHash && type && EMAIL_OTP_TYPES.has(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      logger.info("auth token verification failed", { code: error.code });
      return toLogin(isExpiredCode(error.code) ? "link_expired" : "link");
    }
    return to(type === "recovery" ? routes.resetPassword : next);
  }

  // The browser keeps the URL fragment across this redirect.
  return to(`${routes.authSession}?next=${encodeURIComponent(next)}`);
}
