"use client";

import { useEffect } from "react";

import { authHashRedirect } from "../hash-redirect";

/** Rescues sign-in tokens that Supabase delivered to a page other than /auth/callback. */
export function AuthHashForwarder() {
  useEffect(() => {
    const target = authHashRedirect(window.location);
    if (target) window.location.replace(target);
  }, []);

  return null;
}
