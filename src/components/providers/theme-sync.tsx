"use client";

import { useEffect } from "react";

import { readPreferences, resolveTheme, usePreferences } from "@/lib/preferences";

/** Keeps <html data-theme> in step with the saved preference and the OS. */
export function ThemeSync() {
  const [{ theme }] = usePreferences();

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    // Read storage directly: during hydration the hook still reports the
    // server default, and applying that would flash the wrong theme.
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(readPreferences().theme);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return null;
}
