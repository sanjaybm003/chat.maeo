import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => {
  const quiet = { debug() {}, info() {}, warn() {}, error() {}, child: () => quiet };
  return { logger: quiet };
});
// Every site resolves to a public address, so page reads never touch real DNS.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const load = () => import("./web");

beforeEach(() => {
  vi.resetModules();
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "AWS_BEARER_TOKEN_BEDROCK", "TAVILY_API_KEY"]) vi.stubEnv(name, "");
  vi.stubEnv("BEDROCK_API_KEY", "test-bedrock-key");
  vi.stubEnv("BEDROCK_REGION", "us-east-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reading pages safely", () => {
  it("only accepts public addresses", async () => {
    const { isPublicAddress } = await load();
    for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"]) expect(isPublicAddress(address)).toBe(true);
    for (const address of ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip"]) {
      expect(isPublicAddress(address)).toBe(false);
    }
  });

  it("refuses links that aren't plain public web pages", async () => {
    const { parsePublicUrl } = await load();
    expect(parsePublicUrl("https://example.com/docs#intro").toString()).toBe("https://example.com/docs");
    for (const link of ["file:///etc/passwd", "http://localhost:3000", "https://user:pass@example.com", "http://169.254.169.254/latest", "https://example.com:22", "https://db.internal/", "javascript:alert(1)", "not a url"]) {
      expect(() => parsePublicUrl(link)).toThrow();
    }
  });

  it("keeps the readable text of a page and drops scripts, styles and navigation", async () => {
    const { htmlToText, htmlTitle } = await load();
    const html = `<html><head><title>Pricing &amp; plans</title><style>.x{}</style></head><body><nav>Home · Blog</nav>
      <h1>Plans</h1><p>Team costs <b>$8</b>&nbsp;per seat.</p><script>track()</script><ul><li>Unlimited chats</li><li>Agents &#x2728;</li></ul><footer>© 2026</footer></body></html>`;
    expect(htmlTitle(html)).toBe("Pricing & plans");
    expect(htmlToText(html)).toBe("Plans\nTeam costs $8 per seat.\n\n- Unlimited chats\n- Agents ✨");
  });
});

describe("searchWeb", () => {
  it("reads Bedrock's grounded answer and citations, and bills the searches", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://bedrock-mantle.us-east-1.api.aws/v1/responses");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-bedrock-key");
      const body = JSON.parse(String(init.body));
      expect(body.tools).toEqual([{ type: "web_search", external_web_access: false, search_context_size: "medium" }]);
      return Response.json({
        output: [
          { type: "web_search_call" },
          { type: "web_search_call" },
          {
            type: "message",
            content: [{ type: "output_text", text: "- Next.js 16.3 shipped in August.", annotations: [{ type: "url_citation", title: "Next.js blog", url: "https://nextjs.org/blog" }] }],
          },
        ],
        usage: { input_tokens: 4000, output_tokens: 300 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { searchWeb, formatFindings } = await load();

    const findings = await searchWeb("latest next.js release", new AbortController().signal);

    expect(findings).toMatchObject({ engine: "bedrock-web-search", sources: [{ title: "Next.js blog", url: "https://nextjs.org/blog" }] });
    expect(findings.excerpts).toBeUndefined();
    expect(findings.credits).toBe(26);
    const text = formatFindings("latest next.js release", { ...findings, sources: [...findings.sources, { title: "dup", url: "https://nextjs.org/blog/" }] });
    expect(text).toContain("[1] Next.js blog <https://nextjs.org/blog>");
    expect(text).not.toContain("[2]");
  });

  it("dates the search, then reads the top sources for a deep search and keeps the passages that answer it", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        if (url.endsWith("/responses")) {
          return Response.json({
            output: [
              { type: "web_search_call" },
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "- Next.js 16.3 shipped.",
                    annotations: [
                      { type: "url_citation", title: "Pin", url: "https://www.pinterest.com/pin/1" },
                      { type: "url_citation", title: "Next.js 16.3", url: "https://nextjs.org/blog/next-16-3" },
                    ],
                  },
                ],
              },
            ],
            usage: { input_tokens: 1000, output_tokens: 100 },
          });
        }
        return new Response(
          "<html><head><title>Next.js 16.3</title></head><body><p>Subscribe to our newsletter for more updates from the whole team.</p><p>Next.js 16.3 was released on August 20, 2026 with a faster dev server and a stable proxy.</p></body></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }),
    );
    const { searchWeb, formatFindings } = await load();

    const findings = await searchWeb("latest next.js release date", new AbortController().signal, {
      depth: "deep",
      today: "Tuesday 15 September 2026, 09:05",
    });

    const search = requests.find((request) => request.url.endsWith("/responses"));
    expect(String(search?.body?.instructions)).toContain("It is Tuesday 15 September 2026, 09:05");
    expect(String(search?.body?.input)).toMatch(/^latest next\.js release date \d{4}$/);
    expect(requests.map((request) => request.url)).toContain("https://nextjs.org/blog/next-16-3");
    // The official page is read first; the weak source comes last.
    expect(findings.excerpts?.[0]).toMatchObject({ title: "Next.js 16.3", url: "https://nextjs.org/blog/next-16-3" });
    expect(findings.excerpts?.[0].text).toContain("released on August 20, 2026");
    expect(findings.excerpts?.[0].text).not.toContain("newsletter");
    const text = formatFindings("latest next.js release date", findings);
    expect(text).toContain("[1] Next.js 16.3 <https://nextjs.org/blog/next-16-3>");
    expect(text).toContain('<source url="https://nextjs.org/blog/next-16-3" title="Next.js 16.3">');
  });

  it("falls back to Nova grounding when the account can't use Bedrock's search, and remembers that", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("bedrock-mantle")) return Response.json({ error: { message: "not available for this account" } }, { status: 403 });
        return Response.json({
          output: {
            message: {
              content: [
                { text: "Rates were held at 5.5%." },
                { citationsContent: { citations: [{ location: { web: { url: "https://rbi.org.in/press", domain: "rbi.org.in" } } }] } },
              ],
            },
          },
          usage: { inputTokens: 1000, outputTokens: 200 },
        });
      }),
    );
    const { searchWeb } = await load();

    const first = await searchWeb("rbi repo rate", new AbortController().signal);
    expect(first).toMatchObject({ engine: "nova-grounding", summary: "Rates were held at 5.5%.", sources: [{ title: "rbi.org.in" }] });
    expect(calls[1]).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/model/us.amazon.nova-2-lite-v1%3A0/converse");

    await searchWeb("rbi repo rate again", new AbortController().signal);
    expect(calls.filter((url) => url.includes("bedrock-mantle"))).toHaveLength(1);
  });

  it("says plainly when no engine could search", async () => {
    vi.stubEnv("BEDROCK_API_KEY", "");
    const { searchWeb, webSearchAvailable } = await load();
    expect(webSearchAvailable()).toBe(false);
    await expect(searchWeb("anything", new AbortController().signal)).rejects.toThrow(/No web search/);
  });
});
