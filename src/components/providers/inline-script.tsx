"use client";

/**
 * A script that runs during HTML parsing on the first load and is inert when
 * React renders on the client, as recommended in Next.js' "Preventing flash"
 * guide. Carries the request's CSP nonce so a strict policy allows it.
 */
export function InlineScript({ html, nonce }: { html: string; nonce?: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
