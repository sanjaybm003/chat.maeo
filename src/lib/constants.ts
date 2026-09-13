export const LAST_WORKSPACE_COOKIE = "maeosan-last-workspace";

export const MESSAGE_PAGE_SIZE = 50;
export const MAX_MESSAGE_LENGTH = 4000;

/** Consecutive messages from one person within this window share a header. */
export const MESSAGE_GROUP_WINDOW_MINUTES = 5;

export const TYPING_BROADCAST_INTERVAL_MS = 2500;
export const TYPING_EXPIRY_MS = 5000;

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "🙏"] as const;

export const TEAM_SIZES = [
  { value: "solo", label: "Just me" },
  { value: "2-10", label: "2–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "200+", label: "200+" },
] as const;

export const USE_CASES = [
  { value: "product", label: "Product & engineering" },
  { value: "agency", label: "Agency or studio" },
  { value: "operations", label: "Operations" },
  { value: "sales", label: "Sales & support" },
  { value: "nonprofit", label: "Nonprofit or community" },
  { value: "other", label: "Something else" },
] as const;
