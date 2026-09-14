import "server-only";

import { logger } from "@/lib/logger";

import { BEDROCK_MODEL_IDS } from "../models";
import { bedrockCatalogFresh, recordBedrockCatalog } from "./availability";
import { aiEnv } from "./env";

/**
 * Bedrock's own list of the models a key can call in its region, so pickers
 * only offer models that will answer. Read at most every half hour per server
 * instance, and never trusted if it doesn't look like the list maeosan expects.
 */

const log = logger.child({ module: "bedrock-catalog" });

const LIST_TIMEOUT_MS = 5_000;
/** Fewer of maeosan's ids than this in the list means it's shaped differently; it's ignored rather than hiding everything. */
const MIN_MATCHES = 3;

let checking: Promise<void> | null = null;

async function readCatalog(key: string) {
  try {
    const response = await fetch(`${aiEnv.bedrockMantleUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Bedrock answered ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const ids = new Set((body.data ?? []).flatMap((item) => (typeof item.id === "string" ? [item.id] : [])));
    const missing = [...BEDROCK_MODEL_IDS].filter((id) => !ids.has(id));
    const trusted = BEDROCK_MODEL_IDS.size - missing.length >= MIN_MATCHES;
    recordBedrockCatalog(trusted ? ids : null);
    if (trusted && missing.length > 0) log.info("some Bedrock models can't be called here, so they aren't offered", { missing });
    if (!trusted) log.warn("Bedrock's model list didn't match the catalog; offering every Bedrock model", { listed: ids.size });
  } catch (error) {
    recordBedrockCatalog(null);
    log.warn("couldn't read Bedrock's model list; offering every Bedrock model", { error });
  }
}

/** Starts a fresh read when one is due, and waits for it no longer than waitMs. */
export function refreshBedrockCatalog(waitMs = 1_000): Promise<void> {
  const key = aiEnv.bedrockKey;
  if (!key || bedrockCatalogFresh()) return Promise.resolve();
  const current = (checking ??= readCatalog(key).finally(() => {
    checking = null;
  }));
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, waitMs);
    void current.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
