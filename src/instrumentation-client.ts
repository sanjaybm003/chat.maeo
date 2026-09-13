/**
 * Reports uncaught browser errors to /api/telemetry in production. Paths are
 * scrubbed of ids and tokens, reports are capped per page load, and reporting
 * can never throw.
 */

const ENDPOINT = "/api/telemetry";
const MAX_REPORTS_PER_PAGE = 10;
let reports = 0;

function scrubPath(path: string) {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/[0-9a-f]{32,}/gi, ":token");
}

function report(type: "error" | "unhandledrejection", reason: unknown) {
  if (process.env.NODE_ENV !== "production" || reports >= MAX_REPORTS_PER_PAGE) return;
  reports += 1;
  try {
    const error = reason instanceof Error ? reason : null;
    const body = JSON.stringify({
      type,
      message: String(error?.message ?? reason ?? "Unknown error").slice(0, 1000),
      stack: error?.stack?.slice(0, 6000),
      path: scrubPath(window.location.pathname),
      userAgent: navigator.userAgent.slice(0, 400),
    });
    const queued = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    if (!queued) {
      void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    // Reporting must never become the error.
  }
}

window.addEventListener("error", (event) => report("error", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => report("unhandledrejection", event.reason));
