"use client";

import { useEffect, useRef } from "react";

import { LogoMark } from "@/components/brand/logo";
import { Spinner } from "@/components/ui/spinner";
import { routes, safeNextPath } from "@/lib/routes";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Finishes implicit-flow links whose tokens live in the URL fragment. */
export default function AuthSessionPage() {
  // The fragment is consumed on first read. A second effect run (React Strict
  // Mode in development) would see an empty address bar and cancel the sign-in.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const fail = (errorCode?: string | null) =>
      window.location.replace(`${routes.login}?error=${errorCode === "otp_expired" ? "link_expired" : "link"}`);

    // Drop tokens from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (fragment.get("error") || !accessToken || !refreshToken) {
      fail(fragment.get("error_code"));
      return;
    }

    getSupabaseBrowserClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) return fail();
        window.location.replace(fragment.get("type") === "recovery" ? routes.resetPassword : next);
      })
      .catch(() => fail());
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5">
      <LogoMark size={40} />
      <p className="flex items-center gap-2.5 text-sm text-ink-3">
        <Spinner size={14} />
        Signing you in
      </p>
    </main>
  );
}
