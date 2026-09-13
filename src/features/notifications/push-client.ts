"use client";

import { db, unwrap } from "@/features/workspace/api/client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const SERVICE_WORKER_URL = "/sw.js";

let active = false;

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    Boolean(VAPID_PUBLIC_KEY) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True once this browser holds a live subscription saved to the server. */
export function isPushActive() {
  return active;
}

function decodeApplicationServerKey(base64Url: string) {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, expected: Uint8Array) {
  if (!current) return false;
  const view = new Uint8Array(current);
  return view.length === expected.length && view.every((byte, index) => byte === expected[index]);
}

/**
 * Registers the service worker, subscribes (re-subscribing if the server key
 * rotated) and saves the subscription. Idempotent; safe on every app load.
 */
export async function enablePush(): Promise<boolean> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY || Notification.permission !== "granted") return false;

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;

  const key = decodeApplicationServerKey(VAPID_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  unwrap(
    await db().rpc("save_push_subscription", {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 300),
    }),
  );
  active = true;
  return true;
}

/** Removes this browser's subscription, e.g. on sign out, so the next person gets nothing. */
export async function disablePush() {
  active = false;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await db().rpc("delete_push_subscription", { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
