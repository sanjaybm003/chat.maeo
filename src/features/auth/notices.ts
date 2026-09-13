/**
 * Auth redirects carry a short code, never raw provider text, so nobody can
 * put their own words on the sign-in page through a crafted URL.
 */
const NOTICES: Record<string, string> = {
  link: "That link didn't work. Request a new one below.",
  link_expired:
    "That email link has expired or was already used, often because a newer email replaced it. If you've confirmed already, sign in. Otherwise we'll email you a fresh link.",
  other_browser:
    "Your email is verified, but the link opened in a different browser. Sign in here, or open the newest email in the browser you signed up with.",
  oauth: "Sign-in with that provider didn't finish. Try again.",
  session: "Your session ended. Sign in again to continue.",
  deleted: "Your account was deleted. Thanks for giving maeosan a try.",
};

export function authNotice(code: string | string[] | undefined) {
  if (typeof code !== "string") return null;
  return NOTICES[code] ?? null;
}

/** Which sign-in method to open with: a fresh email link is the fix for a dead one. */
export function initialSignInMethod(code: string | string[] | undefined): "password" | "link" {
  return code === "link_expired" || code === "link" ? "link" : "password";
}
