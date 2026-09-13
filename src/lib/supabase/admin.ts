import "server-only";

import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "@/types/database";

/** Bypasses RLS. Only for Auth admin calls that have already been authorised. */
export function createSupabaseAdminClient() {
  return createClient<Database>(env.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Sends Auth emails on behalf of someone else (for example an invite to an
 * existing account). Uses the implicit flow because the recipient's browser
 * will not hold a PKCE verifier from this server.
 */
export function createSupabaseMailerClient() {
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, flowType: "implicit" },
  });
}
