import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export const db = () => getSupabaseBrowserClient();

type SuccessData<R> = R extends { error: null; data: infer D } ? D : never;

/**
 * Throws the PostgREST error so callers can use try/catch and getErrorMessage,
 * and narrows the response to the success branch's data type.
 */
export function unwrap<R extends { data: unknown; error: { message: string; code?: string } | null }>(result: R): SuccessData<R> {
  if (result.error) throw result.error;
  return result.data as SuccessData<R>;
}

export function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
