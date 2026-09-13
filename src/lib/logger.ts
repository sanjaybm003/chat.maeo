/**
 * Structured logging. On the server each entry is one JSON line (what log
 * pipelines such as Vercel, Datadog or Loki ingest); in the browser it goes to
 * the console with a readable prefix.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): Level {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  if (configured && configured in LEVEL_RANK) return configured;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export function serializeError(error: unknown): Fields {
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; digest?: unknown; hint?: unknown };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 8).join("\n"),
      code: extra.code,
      digest: extra.digest,
      hint: extra.hint,
    };
  }
  if (typeof error === "object" && error !== null) return { ...(error as Fields) };
  return { message: String(error) };
}

function write(level: Level, bindings: Fields, message: string, fields?: Fields) {
  if (LEVEL_RANK[level] < LEVEL_RANK[threshold()]) return;

  const normalized: Fields = { ...fields };
  if ("error" in normalized) normalized.error = serializeError(normalized.error);

  if (typeof window === "undefined") {
    const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...bindings, ...normalized });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }

  const method = level === "debug" ? "debug" : level;
  console[method](`[maeosan] ${message}`, { ...bindings, ...normalized });
}

export interface Logger {
  debug: (message: string, fields?: Fields) => void;
  info: (message: string, fields?: Fields) => void;
  warn: (message: string, fields?: Fields) => void;
  error: (message: string, fields?: Fields) => void;
  child: (bindings: Fields) => Logger;
}

function create(bindings: Fields): Logger {
  return {
    debug: (message, fields) => write("debug", bindings, message, fields),
    info: (message, fields) => write("info", bindings, message, fields),
    warn: (message, fields) => write("warn", bindings, message, fields),
    error: (message, fields) => write("error", bindings, message, fields),
    child: (extra) => create({ ...bindings, ...extra }),
  };
}

export const logger = create({ service: "maeosan" });
