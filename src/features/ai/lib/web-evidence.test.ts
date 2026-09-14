import { describe, expect, it } from "vitest";

import { extractLinks, normalizeUrl, rankSources, relevantExcerpt, sourcesFooter, unverifiedLinks, withRecency } from "./web-evidence";

const september2026 = new Date("2026-09-15T10:00:00Z");

describe("withRecency", () => {
  it("dates searches about what's current, and leaves dated or timeless ones alone", () => {
    expect(withRecency("latest Next.js release", september2026)).toBe("latest Next.js release 2026");
    expect(withRecency("current EUR to INR rate", september2026)).toBe("current EUR to INR rate 2026");
    expect(withRecency("latest iPhone price 2025", september2026)).toBe("latest iPhone price 2025");
    expect(withRecency("how does TCP handshake work", september2026)).toBe("how does TCP handshake work");
  });
});

describe("normalizeUrl and extractLinks", () => {
  it("matches the same page however it's written", () => {
    expect(normalizeUrl("https://www.Example.com/docs/?a=1#top")).toBe("example.com/docs");
    expect(normalizeUrl("mailto:someone@example.com")).toBeNull();
    expect(normalizeUrl("not a link")).toBeNull();
  });

  it("finds bare and markdown links without trailing punctuation", () => {
    expect(extractLinks("See [the docs](https://nextjs.org/docs/app). Also https://vercel.com/blog, and https://vercel.com/blog.")).toEqual([
      "https://nextjs.org/docs/app",
      "https://vercel.com/blog",
    ]);
  });
});

describe("rankSources", () => {
  it("drops duplicates and reads primary sources first and weak ones last", () => {
    const ranked = rankSources([
      { title: "Pin", url: "https://www.pinterest.com/pin/1" },
      { title: "News", url: "https://news.example.com/a" },
      { title: "News again", url: "https://news.example.com/a/" },
      { title: "Docs", url: "https://docs.example.com/guide" },
      { title: "Agency", url: "https://www.fda.gov/drugs" },
    ]);
    expect(ranked.map((source) => source.title)).toEqual(["Docs", "Agency", "News", "Pin"]);
  });
});

describe("unverifiedLinks", () => {
  const material = ["Web search:\n[1] Release notes <https://nextjs.org/blog/next-16-3>", "Earlier Sam shared https://github.com/acme/app/pull/42"];

  it("flags deep links nothing mentioned and trusts what was read", () => {
    const reply = [
      "Next.js 16.3 is out: https://nextjs.org/blog/next-16-3.",
      "Details at https://nextjs.org/blog/next-16-3-migration-guide",
      "PR: https://github.com/acme/app/pull/42",
      "Home: https://nextjs.org",
      "Section: https://nextjs.org/blog",
    ].join("\n");
    expect(unverifiedLinks(reply, material)).toEqual(["https://nextjs.org/blog/next-16-3-migration-guide"]);
  });

  it("finds nothing to flag in a reply without links", () => {
    expect(unverifiedLinks("All good.", material)).toEqual([]);
  });
});

describe("relevantExcerpt", () => {
  const page = [
    "Welcome to our site. Sign up for the newsletter to hear about offers and events near you.",
    "The Model X battery lasts about 14 hours on a charge, according to our lab tests in March 2026.",
    "Our company was founded by two friends who loved building things in a small garage.",
    "Pricing: the Model X starts at $499, with the larger battery option at $599 from October.",
  ].join("\n\n");

  it("keeps the passages about the question, in page order, within the limit", () => {
    const excerpt = relevantExcerpt(page, "Model X price and battery life", 400);
    expect(excerpt).toContain("14 hours");
    expect(excerpt).toContain("$499");
    expect(excerpt).not.toContain("newsletter");
    expect(excerpt.indexOf("14 hours")).toBeLessThan(excerpt.indexOf("$499"));
    expect(excerpt.length).toBeLessThanOrEqual(400);
  });

  it("falls back to the opening when nothing matches", () => {
    expect(relevantExcerpt(page, "quantum chromodynamics")).toMatch(/^Welcome to our site/);
  });

  it("matches whole words with their common endings, not fragments", () => {
    const lines = "Subscribe for updates from the whole team every single week.\nVersion 4 was released on 2 March 2026 after a long beta.";
    expect(relevantExcerpt(lines, "release date")).toBe("Version 4 was released on 2 March 2026 after a long beta.");
  });
});

describe("sourcesFooter", () => {
  const sources = [
    { title: "A", url: "https://news.example.com/a" },
    { title: "B", url: "https://docs.example.com/b" },
  ];

  it("adds sources to a reply that linked nothing, primary ones first", () => {
    expect(sourcesFooter("It launched in May.", sources)).toBe(
      "\n\nSources: [docs.example.com](https://docs.example.com/b) · [news.example.com](https://news.example.com/a)",
    );
  });

  it("leaves replies that already link their sources, or had none, alone", () => {
    expect(sourcesFooter("See https://example.com/x", sources)).toBe("");
    expect(sourcesFooter("It launched in May.", [])).toBe("");
  });
});
