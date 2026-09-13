import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database } from "@/types/database";

export type BrowserSupabase = SupabaseClient<Database>;

let client: BrowserSupabase | undefined;

/** One client per tab: it owns the auth session and the realtime socket. */
export function getSupabaseBrowserClient(): BrowserSupabase {
  if (!client) {
    client = createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    });
  }
  return client;
}
