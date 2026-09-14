import { describe, expect, it } from "vitest";

import { MAX_INCOMING_TEXT, parseIncoming } from "./incoming";

describe("parseIncoming", () => {
  it("reads Slack, Discord and plain JSON shapes", () => {
    expect(parseIncoming('{"text":"Deploy finished","username":"Vercel"}', "application/json")).toEqual({ text: "Deploy finished", name: "Vercel" });
    expect(parseIncoming('{"content":"Build #42 failed"}', "application/json")).toEqual({ text: "Build #42 failed", name: null });
    expect(parseIncoming('{"message":"Disk at 91%","source":"Grafana"}', null)).toEqual({ text: "Disk at 91%", name: "Grafana" });
  });

  it("falls back to Slack blocks, attachments and Discord embeds", () => {
    const blocks = { blocks: [{ type: "header", text: { type: "plain_text", text: "Incident" } }, { type: "section", text: { type: "mrkdwn", text: "API latency is up" } }] };
    expect(parseIncoming(JSON.stringify(blocks), "application/json")?.text).toBe("Incident\nAPI latency is up");
    const attachments = { attachments: [{ pretext: "New lead", title: "Acme Corp", fallback: "Wants a demo" }] };
    expect(parseIncoming(JSON.stringify(attachments), "application/json")?.text).toBe("New lead\nAcme Corp\nWants a demo");
    expect(parseIncoming(JSON.stringify({ embeds: [{ title: "Release", description: "v2.1 is live" }] }), "application/json")?.text).toBe("Release\nv2.1 is live");
  });

  it("accepts form posts, including Slack's legacy payload field, and plain text", () => {
    expect(parseIncoming("text=Hello%20team&username=Forms", "application/x-www-form-urlencoded")).toEqual({ text: "Hello team", name: "Forms" });
    expect(parseIncoming(`payload=${encodeURIComponent('{"text":"From payload"}')}`, "application/x-www-form-urlencoded")?.text).toBe("From payload");
    expect(parseIncoming("  Backup done  ", "text/plain")).toEqual({ text: "Backup done", name: null });
  });

  it("refuses empty posts, JSON without text and broken JSON, and caps the length", () => {
    expect(parseIncoming("   ", "text/plain")).toBeNull();
    expect(parseIncoming('{"action":"opened"}', "application/json")).toBeNull();
    expect(parseIncoming("{not json", "application/json")).toBeNull();
    expect(parseIncoming(JSON.stringify({ text: "x".repeat(10_000) }), "application/json")?.text).toHaveLength(MAX_INCOMING_TEXT);
  });
});
