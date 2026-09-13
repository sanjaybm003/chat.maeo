/**
 * Content Security Policy with a per-request nonce and 'strict-dynamic':
 * only scripts Next.js stamps with this request's nonce (and what they load)
 * can run, which shuts the door on injected scripts. Connections are limited
 * to this origin and the Supabase project (HTTPS and realtime WebSockets).
 */

export function createNonce() {
  return btoa(crypto.randomUUID());
}

interface CspOptions {
  nonce: string;
  supabaseUrl: string;
  isDev: boolean;
}

export function buildContentSecurityPolicy({ nonce, supabaseUrl, isDev }: CspOptions) {
  let supabaseOrigin = "";
  let realtimeOrigin = "";
  try {
    const url = new URL(supabaseUrl);
    supabaseOrigin = url.origin;
    realtimeOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  } catch {
    // Misconfigured URL: the policy simply won't allow it.
  }

  const directives: Record<string, Array<string | false>> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", isDev && "'unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", supabaseOrigin],
    "media-src": ["'self'", "blob:", supabaseOrigin],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabaseOrigin, realtimeOrigin, isDev && "ws:"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([name, sources]) => [name, ...sources.filter(Boolean)].join(" "))
    .join("; ");

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}
