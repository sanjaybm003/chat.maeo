import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createAppJwt, createInstallState, readInstallState } = await import("./github");

describe("createAppJwt", () => {
  it("signs an RS256 token for the app that GitHub's clock drift allowance accepts", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = Date.UTC(2026, 8, 14, 12, 0, 0);

    const token = createAppJwt("123456", pem, now);
    const [header, payload, signature] = token.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.iss).toBe("123456");
    expect(claims.iat).toBe(now / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), createPublicKey(privateKey), Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("accepts a key whose line breaks arrive escaped from an environment variable", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    expect(() => createAppJwt("1", pem.replace(/\n/g, "\\n").replace(/\\n/g, "\n"))).not.toThrow();
  });
});

describe("install state", () => {
  const input = { workspaceId: "5f0c7a0e-0000-4000-8000-000000000001", userId: "5f0c7a0e-0000-4000-8000-000000000002" };
  const now = Date.UTC(2026, 8, 14);

  it("round-trips for ten minutes with the same secret", () => {
    const state = createInstallState("secret", input, now);
    expect(readInstallState("secret", state, now + 9 * 60_000)).toEqual(input);
    expect(readInstallState("secret", state, now + 11 * 60_000)).toBeNull();
  });

  it("rejects tampering, other secrets and garbage", () => {
    const state = createInstallState("secret", input, now);
    const [payload, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), w: "other" })).toString("base64url");
    expect(readInstallState("secret", `${forged}.${mac}`, now)).toBeNull();
    expect(readInstallState("other-secret", state, now)).toBeNull();
    expect(readInstallState("secret", "nope", now)).toBeNull();
    expect(readInstallState("secret", `${state}.extra`, now)).toBeNull();
  });
});
