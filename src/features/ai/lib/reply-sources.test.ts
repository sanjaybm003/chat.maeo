import { describe, expect, it } from "vitest";

import { arrangeSources, collectSources, splitSources } from "./reply-sources";

const material = [
  [
    'Web search for "next.js 16.3":',
    "- 16.3 shipped in August.",
    "",
    "Sources:",
    "[1] Next.js 16.3 release notes <https://nextjs.org/blog/next-16-3>",
    "[2] Upgrade guide <https://nextjs.org/docs/app/guides/upgrading>",
  ].join("\n"),
  "Page: Vercel changelog\nURL: https://vercel.com/changelog\n\nText of the page",
  "Sam shared https://github.com/acme/app/pull/42 earlier",
];
const known = collectSources(material);

describe("collectSources", () => {
  it("keeps the best title each page was given", () => {
    expect(known.get("nextjs.org/blog/next-16-3")?.title).toBe("Next.js 16.3 release notes");
    expect(known.get("vercel.com/changelog")?.title).toBe("Vercel changelog");
    expect(known.get("github.com/acme/app/pull/42")?.title).toBe("github.com");
  });
});

describe("arrangeSources", () => {
  it("numbers the links the agent read, cites them in place and lists them once at the end", () => {
    const reply = [
      "Next.js 16.3 is out, per [the release notes](https://nextjs.org/blog/next-16-3).",
      "Follow [the upgrade guide](https://nextjs.org/docs/app/guides/upgrading) and again [the notes](https://nextjs.org/blog/next-16-3/).",
      "Also see https://vercel.com/changelog.",
    ].join("\n");
    const { text, sources } = arrangeSources(reply, { known });
    expect(text).toBe(
      [
        "Next.js 16.3 is out, per the release notes [1].",
        "Follow the upgrade guide [2] and again the notes [1].",
        "Also see [3].",
        "",
        "**Sources**",
        "1. [Next.js 16.3 release notes](https://nextjs.org/blog/next-16-3)",
        "2. [Upgrade guide](https://nextjs.org/docs/app/guides/upgrading)",
        "3. [Vercel changelog](https://vercel.com/changelog)",
      ].join("\n"),
    );
    expect(sources).toHaveLength(3);
  });

  it("drops addresses nothing backs up, keeps front pages, and leaves code alone", () => {
    const reply = [
      "Read [the migration guide](https://nextjs.org/docs/made-up-page) (https://example.com/invented/path) or visit https://nextjs.org.",
      "```bash",
      "curl https://example.com/invented/path",
      "```",
    ].join("\n");
    const { text, sources } = arrangeSources(reply, { known });
    expect(text).toBe(
      ["Read the migration guide or visit https://nextjs.org.", "```bash", "curl https://example.com/invented/path", "```"].join("\n"),
    );
    expect(sources).toEqual([]);
  });

  it("replaces a sources section the model wrote with the verified list", () => {
    const reply = "It shipped in August.\n\n### Sources\n- [Notes](https://nextjs.org/blog/next-16-3)\n- https://invented.example.com/page";
    expect(arrangeSources(reply, { known }).text).toBe(
      "It shipped in August.\n\n**Sources**\n1. [Next.js 16.3 release notes](https://nextjs.org/blog/next-16-3)",
    );
    const oneLine = "It shipped in August.\n\nSources: [nextjs.org](https://nextjs.org/blog/next-16-3)";
    expect(arrangeSources(oneLine, { known }).sources).toHaveLength(1);
  });

  it("lists the best web sources when a web answer cites nothing", () => {
    const fallback = [
      { title: "Pin", url: "https://www.pinterest.com/pin/1" },
      { title: "Docs", url: "https://docs.example.com/a" },
    ];
    const { text } = arrangeSources("It shipped in August.", { known, fallback });
    expect(text).toBe("It shipped in August.\n\n**Sources**\n1. [Docs](https://docs.example.com/a)\n2. [Pin](https://www.pinterest.com/pin/1)");
    expect(arrangeSources("Nothing from the web here.", { known }).text).toBe("Nothing from the web here.");
  });
});

describe("splitSources", () => {
  it("separates the source list from the reply, titles and all", () => {
    const { text } = arrangeSources("See [notes](https://nextjs.org/blog/next-16-3).", {
      known: new Map([["nextjs.org/blog/next-16-3", { title: "Notes [beta]", url: "https://nextjs.org/blog/next-16-3" }]]),
    });
    expect(splitSources(text)).toEqual({ body: "See notes [1].", sources: [{ title: "Notes [beta]", url: "https://nextjs.org/blog/next-16-3" }] });
    expect(splitSources("No list here.")).toEqual({ body: "No list here.", sources: [] });
  });
});
