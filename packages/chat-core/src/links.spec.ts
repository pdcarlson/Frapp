import { describe, expect, it } from "vitest";
import { bareUrls, isOpenableHref, isSafeHref } from "./links";

describe("isSafeHref", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "mailto:a@example.com",
    "example.com",
    "/path",
  ])("accepts %s", (href) => {
    expect(isSafeHref(href)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "jav\tascript:alert(1)",
    "data:text/html,hi",
    "//attacker.example/login",
  ])("rejects %s", (href) => {
    expect(isSafeHref(href)).toBe(false);
  });
});

describe("isOpenableHref", () => {
  it("needs an absolute safe scheme, since a phone has no page to resolve against", () => {
    expect(isOpenableHref("https://example.com")).toBe(true);
    expect(isOpenableHref("mailto:a@example.com")).toBe(true);
    expect(isOpenableHref("example.com")).toBe(false);
    expect(isOpenableHref("javascript:alert(1)")).toBe(false);
    expect(isOpenableHref("https://exa\tmple.com")).toBe(false);
  });
});

// The markdown syntax (`[text](url)`, `<url>`, code) is the parser's; the
// mobile renderer's spec (`apps/mobile/components/chat/message-markdown.spec.tsx`)
// covers how those and bare URLs come out of a parsed body.
describe("bareUrls", () => {
  const link = (text: string, start: number, href = text.slice(start)) => ({
    start,
    end: start + href.length,
    href,
  });

  it("finds nothing in plain or empty text", () => {
    expect(bareUrls("hello there")).toEqual([]);
    expect(bareUrls("")).toEqual([]);
  });

  it("finds a URL and keeps sentence punctuation out of it", () => {
    const text = "see https://frapp.live/docs. thanks";
    expect(bareUrls(text)).toEqual([link(text, 4, "https://frapp.live/docs")]);
  });

  it("finds each of several URLs, in order", () => {
    const text = "http://a.test and HTTPS://b.test";
    expect(bareUrls(text)).toEqual([
      link(text, 0, "http://a.test"),
      link(text, 18, "HTTPS://b.test"),
    ]);
  });

  it("keeps a paren the URL opens and drops one it does not", () => {
    expect(bareUrls("(see https://x.test/a)")).toEqual([
      link("(see https://x.test/a)", 5, "https://x.test/a"),
    ]);
    const wiki = "https://en.wikipedia.org/wiki/Frapp_(drink)";
    expect(bareUrls(wiki)).toEqual([link(wiki, 0)]);
  });

  it("does not start a URL in the middle of a word", () => {
    expect(bareUrls("xhttps://x.test")).toEqual([]);
  });

  it("does not take a scheme with no host", () => {
    expect(bareUrls("https:// is a prefix")).toEqual([]);
    expect(bareUrls("https://...")).toEqual([]);
  });

  it("keeps a stray emphasis marker out of the URL", () => {
    expect(bareUrls("*https://x.test*")).toEqual([
      link("*https://x.test*", 1, "https://x.test"),
    ]);
  });

  it("stays fast on a hostile body at the 10,000-character cap", () => {
    const bodies = [
      "https://a" + ")".repeat(9_990),
      "https://" + ".".repeat(9_992),
      "https:// ".repeat(1_111),
      "(https://a ".repeat(909),
      "h".repeat(10_000),
    ];
    for (const body of bodies) {
      const started = performance.now();
      bareUrls(body);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});
