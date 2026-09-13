import type { Instrumentation } from "next";

/** Validates configuration once per server start; fails fast in production. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ validateEnv }, { logger }] = await Promise.all([import("@/lib/config/validate-env"), import("@/lib/logger")]);
  const { errors, warnings } = validateEnv();

  for (const warning of warnings) logger.warn(warning);
  if (errors.length > 0) {
    logger.error("invalid environment configuration", { errors });
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Invalid environment configuration:\n${errors.join("\n")}`);
    }
  }
}

/** Every unhandled server error, as one structured log line with its route. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { logger } = await import("@/lib/logger");
  logger.error("unhandled request error", {
    error,
    method: request.method,
    path: request.path.split("?")[0].replace(/[0-9a-f]{32,}/gi, ":token"),
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
