/**
 * Cleans the configured sender. Hosting dashboards such as Vercel store values
 * literally, so a value pasted as "maeosan <team@example.com>" keeps its quotes,
 * which Resend rejects as an invalid `from` field.
 */
export function normalizeEmailFrom(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  return cleaned || null;
}
