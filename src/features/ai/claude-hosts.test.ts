import { describe, expect, it } from "vitest";

import { bedrockModelId, describeBedrockKey, onBedrock, readClaudeSettings, resolveClaudeHost } from "./claude-hosts";
import { creditsForUsage } from "./credits";
import { findModel } from "./models";

/** A made-up short-term key with the real format: a base64 presigned request after the prefix. */
const shortTermKey = (region: string, date: string) =>
  `bedrock-api-key-${btoa(
    `bedrock.amazonaws.com/?Action=CallWithBearerToken&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ASIAEXAMPLEEXAMPLE%2F${date.slice(0, 8)}%2F${region}%2Fbedrock%2Faws4_request&X-Amz-Date=${date}&X-Amz-Expires=43200&X-Amz-Signature=0000&Version=1`,
  )}`;

const MANTLE_URL = "https://bedrock-mantle.us-east-1.api.aws/anthropic";

describe("resolveClaudeHost", () => {
  it("uses whichever Claude key is set, preferring Anthropic when both are", () => {
    expect(resolveClaudeHost({ preferred: null, anthropicKey: null, bedrockKey: null })).toBeNull();
    expect(resolveClaudeHost({ preferred: null, anthropicKey: null, bedrockKey: "b" })).toBe("bedrock");
    expect(resolveClaudeHost({ preferred: null, anthropicKey: "a", bedrockKey: "b" })).toBe("anthropic");
  });

  it("honours an explicit choice only when that key exists", () => {
    expect(resolveClaudeHost({ preferred: "bedrock", anthropicKey: "a", bedrockKey: "b" })).toBe("bedrock");
    expect(resolveClaudeHost({ preferred: "bedrock", anthropicKey: "a", bedrockKey: null })).toBe("anthropic");
    expect(resolveClaudeHost({ preferred: "anthropic", anthropicKey: null, bedrockKey: "b" })).toBe("bedrock");
  });
});

describe("describeBedrockKey", () => {
  it("reads a short-term key's region and expiry without calling AWS", () => {
    expect(describeBedrockKey(shortTermKey("eu-west-1", "20260914T112732Z"))).toEqual({
      region: "eu-west-1",
      expiresAt: new Date("2026-09-14T23:27:32Z"),
    });
  });

  it("returns null for other keys and nothing useful for garbled ones", () => {
    expect(describeBedrockKey("ABSK-example-long-term-key")).toBeNull();
    expect(describeBedrockKey("bedrock-api-key-!!!")).toEqual({ region: null, expiresAt: null });
  });
});

describe("readClaudeSettings", () => {
  it("understands Claude Code's Bedrock layout", () => {
    const key = shortTermKey("us-east-1", "20260914T112732Z");
    expect(readClaudeSettings({ ANTHROPIC_API_KEY: key, ANTHROPIC_BASE_URL: MANTLE_URL, ANTHROPIC_WORKSPACE_ID: "default" })).toEqual({
      anthropicKey: null,
      bedrockKey: key,
      bedrockRegion: "us-east-1",
      host: "bedrock",
    });
  });

  it("treats any key as a Bedrock key when the base URL is Bedrock's, taking the region from it", () => {
    expect(
      readClaudeSettings({ ANTHROPIC_API_KEY: "ABSK-example-long-term-key", ANTHROPIC_BASE_URL: "https://bedrock-mantle.eu-central-1.api.aws/anthropic" }),
    ).toMatchObject({ host: "bedrock", anthropicKey: null, bedrockRegion: "eu-central-1" });
  });

  it("recognises a short-term Bedrock key on its own and uses its region unless told otherwise", () => {
    const key = shortTermKey("ap-south-1", "20260914T112732Z");
    expect(readClaudeSettings({ ANTHROPIC_API_KEY: key })).toMatchObject({ host: "bedrock", bedrockRegion: "ap-south-1" });
    expect(readClaudeSettings({ ANTHROPIC_API_KEY: key, BEDROCK_REGION: "us-west-2" })).toMatchObject({ bedrockRegion: "us-west-2" });
  });

  it("keeps a real Anthropic key on Anthropic, beside a separate Bedrock key", () => {
    expect(readClaudeSettings({ ANTHROPIC_API_KEY: "sk-ant-test" })).toEqual({
      anthropicKey: "sk-ant-test",
      bedrockKey: null,
      bedrockRegion: "us-east-1",
      host: "anthropic",
    });
    expect(readClaudeSettings({ ANTHROPIC_API_KEY: "sk-ant-test", BEDROCK_API_KEY: "b" })).toMatchObject({ host: "anthropic" });
    expect(readClaudeSettings({ ANTHROPIC_API_KEY: "sk-ant-test", BEDROCK_API_KEY: "b", CLAUDE_HOST: "bedrock" })).toMatchObject({
      host: "bedrock",
    });
  });
});

describe("bedrockModelId", () => {
  it("maps catalog ids to each Bedrock endpoint", () => {
    expect(bedrockModelId("claude-opus-5", "mantle")).toBe("anthropic.claude-opus-5");
    expect(bedrockModelId("claude-haiku-4-5", "mantle")).toBe("anthropic.claude-haiku-4-5");
    expect(bedrockModelId("claude-sonnet-5", "runtime")).toBe("global.anthropic.claude-sonnet-5");
    expect(bedrockModelId("claude-haiku-4-5", "runtime")).toBe("global.anthropic.claude-haiku-4-5-20251001-v1:0");
  });
});

describe("onBedrock", () => {
  it("drops hosted web search and bills at Bedrock's regional rate", () => {
    const sonnet = findModel("claude-sonnet-5")!;
    const bedrock = onBedrock(sonnet);
    expect(bedrock).toMatchObject({ id: "claude-sonnet-5", webSearch: null, inputPrice: 2.2, outputPrice: 11 });
    const usage = { inputTokens: 40_000, outputTokens: 5_000 };
    expect(creditsForUsage(bedrock, usage)).toBeGreaterThan(creditsForUsage(sonnet, usage));
    expect(sonnet.webSearch).not.toBeNull();
  });
});
