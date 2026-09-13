export const routes = {
  home: "/",
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  checkEmail: "/check-email",
  authCallback: "/auth/callback",
  authSession: "/auth/session",
  onboarding: {
    profile: "/onboarding",
    workspace: "/onboarding/workspace",
    invite: (slug: string) => `/onboarding/invite?workspace=${encodeURIComponent(slug)}`,
  },
  invite: (token: string) => `/invite/${token}`,
  workspace: (slug: string) => `/w/${slug}`,
  conversation: (slug: string, conversationId: string) => `/w/${slug}/c/${conversationId}`,
  contacts: (slug: string) => `/w/${slug}/contacts`,
  agents: (slug: string) => `/w/${slug}/agents`,
  newAgent: (slug: string, prompt?: string) =>
    prompt ? `/w/${slug}/agents/new?prompt=${encodeURIComponent(prompt)}` : `/w/${slug}/agents/new`,
  agent: (slug: string, agentId: string) => `/w/${slug}/agents/${agentId}`,
  settings: (slug: string, section: SettingsSection = "profile") => `/w/${slug}/settings/${section}`,
} as const;

export type SettingsSection = "profile" | "preferences" | "workspace" | "ai" | "account";

const PUBLIC_PREFIXES = ["/auth/", "/invite/", "/api/"];
const PUBLIC_PATHS = new Set<string>([
  routes.login,
  routes.signup,
  routes.forgotPassword,
  routes.checkEmail,
]);
const GUEST_ONLY_PATHS = new Set<string>([routes.login, routes.signup, routes.forgotPassword]);

export function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isGuestOnlyPath(pathname: string) {
  return GUEST_ONLY_PATHS.has(pathname);
}

/** Only same-origin relative paths survive; anything else falls back. */
export function safeNextPath(value: string | null | undefined, fallback: string = routes.home) {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

export function absoluteUrl(siteUrl: string, path: string) {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
