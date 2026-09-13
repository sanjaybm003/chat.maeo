/**
 * Coordinates the tabs one person has open so alerts happen exactly once.
 *
 * Leadership uses the Web Locks API: every tab asks for the same exclusive
 * lock and holds it forever; the browser grants it to one tab and hands it to
 * the next when that tab closes. Tabs also broadcast when they are visible, so
 * a background leader stays quiet while the person is looking at another tab.
 */

const VISIBLE_TTL_MS = 7000;
const HEARTBEAT_MS = 5000;

let leader = false;
let started = false;
let lastOtherVisibleAt = 0;

export function startTabCoordinator(scope: string) {
  if (started || typeof window === "undefined") return;
  started = true;

  if ("locks" in navigator && navigator.locks) {
    void navigator.locks
      .request(`maeosan:leader:${scope}`, () => {
        leader = true;
        return new Promise<void>(() => {});
      })
      .catch(() => {
        leader = true;
      });
  } else {
    leader = true;
  }

  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(`maeosan:tabs:${scope}`);
  const announce = () => {
    if (document.visibilityState === "visible") channel.postMessage("visible");
  };
  channel.onmessage = (event) => {
    if (event.data === "visible") lastOtherVisibleAt = Date.now();
  };
  document.addEventListener("visibilitychange", announce);
  window.setInterval(announce, HEARTBEAT_MS);
  announce();
}

export function isTabLeader() {
  return leader;
}

/**
 * Should this tab raise an alert (sound, pop-up)? The visible tab always may;
 * otherwise only the leader, and only if no other tab is currently visible.
 */
export function shouldThisTabAlert() {
  if (typeof document === "undefined") return false;
  if (document.visibilityState === "visible") return true;
  return leader && Date.now() - lastOtherVisibleAt > VISIBLE_TTL_MS;
}
