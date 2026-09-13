"use client";

import { useEffect } from "react";

import { LogoMark } from "@/components/brand/logo";
import { Spinner } from "@/components/ui/spinner";
import { routes, safeNextPath } from "@/lib/routes";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Finishes implicit-flow links whose tokens live in the URL fragment. */
export default function AuthSessionPage() {
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    const accessToken = fragment.get("access_token");
    const refreshToken = fragment.get("refresh_token");
    const fail = () => window.location.replace(`${routes.login}?error=link`);

    // Drop tokens from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (fragment.get("error") || !accessToken || !refreshToken) {
      fail();
      return;
    }

    getSupabaseBrowserClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) return fail();
        window.location.replace(fragment.get("type") === "recovery" ? routes.resetPassword : next);
      })
      .catch(fail);
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
