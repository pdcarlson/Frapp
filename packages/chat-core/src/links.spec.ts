import { describe, expect, it } from "vitest";
import { isOpenableHref, isSafeHref, linkSegments } from "./links";

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

describe("linkSegments", () => {
  it("returns plain text as one segment", () => {
    expect(linkSegments("hello there")).toEqual([
      { kind: "text", text: "hello there" },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(linkSegments("")).toEqual([]);
  });

  it("links a bare URL and keeps sentence punctuation out of it", () => {
    expect(linkSegments("see https://frapp.live/docs. thanks")).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "link",
        text: "https://frapp.live/docs",
        href: "https://frapp.live/docs",
      },
      { kind: "text", text: ". thanks" },
    ]);
  });

  it("keeps a paren the URL opens and drops one it does not", () => {
    expect(linkSegments("(see https://x.test/a)")).toEqual([
      { kind: "text", text: "(see " },
      { kind: "link", text: "https://x.test/a", href: "https://x.test/a" },
      { kind: "text", text: ")" },
    ]);
    const wiki = "https://en.wikipedia.org/wiki/Frapp_(drink)";
    expect(linkSegments(wiki)).toEqual([
      { kind: "link", text: wiki, href: wiki },
    ]);
  });

  it("does not start a URL in the middle of a word", () => {
    expect(linkSegments("xhttps://x.test")).toEqual([
      { kind: "text", text: "xhttps://x.test" },
    ]);
  });

  it("does not link a scheme with no host", () => {
    expect(linkSegments("https:// is a prefix")).toEqual([
      { kind: "text", text: "https:// is a prefix" },
    ]);
  });

  it("links a markdown link by its label", () => {
    expect(linkSegments("read [the docs](https://x.test/docs) now")).toEqual([
      { kind: "text", text: "read " },
      { kind: "link", text: "the docs", href: "https://x.test/docs" },
      { kind: "text", text: " now" },
    ]);
  });

  it("allows one level of parens in a markdown target", () => {
    expect(
      linkSegments("[wiki](https://en.wikipedia.org/wiki/Frapp_(drink))"),
    ).toEqual([
      {
        kind: "link",
        text: "wiki",
        href: "https://en.wikipedia.org/wiki/Frapp_(drink)",
      },
    ]);
  });

  it("renders an unsafe or relative markdown target as its label alone", () => {
    expect(linkSegments("[click](javascript:alert(1))")).toEqual([
      { kind: "text", text: "click" },
    ]);
    expect(linkSegments("[phish](//attacker.example)")).toEqual([
      { kind: "text", text: "phish" },
    ]);
    expect(linkSegments("[site](example.com)")).toEqual([
      { kind: "text", text: "site" },
    ]);
  });

  it("links a CommonMark autolink by its URL", () => {
    expect(linkSegments("<https://x.test/a>")).toEqual([
      { kind: "link", text: "https://x.test/a", href: "https://x.test/a" },
    ]);
  });

  it("never links inside inline or fenced code", () => {
    expect(linkSegments("run `curl https://x.test` first")).toEqual([
      { kind: "text", text: "run `curl https://x.test` first" },
    ]);
    const fenced = "```\nhttps://x.test\n```";
    expect(linkSegments(fenced)).toEqual([{ kind: "text", text: fenced }]);
  });

  it("still links after an unclosed backtick", () => {
    expect(linkSegments("a ` then https://x.test")).toEqual([
      { kind: "text", text: "a ` then " },
      { kind: "link", text: "https://x.test", href: "https://x.test" },
    ]);
  });

  it("keeps emphasis markers out of a bare URL", () => {
    expect(linkSegments("**https://x.test**")).toEqual([
      { kind: "text", text: "**" },
      { kind: "link", text: "https://x.test", href: "https://x.test" },
      { kind: "text", text: "**" },
    ]);
  });

  it("stays fast on a hostile body at the 10,000-character cap", () => {
    const bodies = [
      "[".repeat(10_000),
      "`".repeat(1).padEnd(10_000, "` "),
      "<https://".repeat(1_100),
      "https://a" + ")".repeat(9_990),
      "[a](" + "h".repeat(9_996),
    ];
    for (const body of bodies) {
      const started = performance.now();
      linkSegments(body);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});
