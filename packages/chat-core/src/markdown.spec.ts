import { describe, expect, it } from "vitest";
import { MESSAGE_MARKDOWN_ELEMENTS, remarkBareUrls } from "./markdown";

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  position?: unknown;
}

const text = (value: string): Node => ({ type: "text", value });
const run = (tree: Node, content = "") =>
  remarkBareUrls({ content })(tree as never);

/** A node the parser would have produced for `content.slice(start, end)`. */
const at = (node: Node, start: number, end: number): Node => ({
  ...node,
  position: { start: { offset: start }, end: { offset: end } },
});

describe("MESSAGE_MARKDOWN_ELEMENTS", () => {
  it("is the spec's formatting set and nothing wider", () => {
    expect([...MESSAGE_MARKDOWN_ELEMENTS].sort()).toEqual(
      ["a", "br", "code", "em", "p", "pre", "strong"].sort(),
    );
  });
});

describe("remarkBareUrls", () => {
  it("splits a text node around each bare URL", () => {
    const paragraph: Node = {
      type: "paragraph",
      children: [text("see https://x.test/a. or http://y.test")],
    };
    run({ type: "root", children: [paragraph] });
    expect(paragraph.children).toEqual([
      text("see "),
      { type: "link", url: "https://x.test/a", children: [text("https://x.test/a")] },
      text(". or "),
      { type: "link", url: "http://y.test", children: [text("http://y.test")] },
    ]);
  });

  it("links inside emphasis", () => {
    const strong: Node = { type: "strong", children: [text("https://x.test")] };
    run({ type: "root", children: [{ type: "paragraph", children: [strong] }] });
    expect(strong.children).toEqual([
      { type: "link", url: "https://x.test", children: [text("https://x.test")] },
    ]);
  });

  it("leaves a link's label alone", () => {
    const label = text("https://shown.test");
    const link: Node = { type: "link", url: "https://real.test", children: [label] };
    run({ type: "root", children: [{ type: "paragraph", children: [link] }] });
    expect(link.children).toEqual([label]);
  });

  it("leaves code alone, since code carries a value and no text children", () => {
    const inline: Node = { type: "inlineCode", value: "curl https://x.test" };
    const block: Node = { type: "code", value: "https://x.test" };
    const paragraph: Node = { type: "paragraph", children: [inline] };
    const root: Node = { type: "root", children: [paragraph, block] };
    run(root);
    expect(paragraph.children).toEqual([inline]);
    expect(root.children).toEqual([paragraph, block]);
  });

  it("keeps a text node with no URL as the same node, position and all", () => {
    const plain: Node = { ...text("nothing here"), position: { start: 1 } };
    const paragraph: Node = { type: "paragraph", children: [plain] };
    run({ type: "root", children: [paragraph] });
    expect(paragraph.children![0]).toBe(plain);
  });

  // What the parser hands over for a URL holding a delimiter pair: the URL's
  // text stops at the emphasis, and the raw body says where it really ends.
  it("links a URL the parser split at emphasis whole, as typed", () => {
    const content = "see https://x.test/pkg/__init__.py now";
    const open = content.indexOf("__");
    const close = content.indexOf("__", open + 2) + 2;
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text(content.slice(0, open)), 0, open),
        at({ type: "strong", children: [at(text("init"), open + 2, close - 2)] }, open, close),
        at(text(content.slice(close)), close, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    const url = "https://x.test/pkg/__init__.py";
    const withoutPositions = paragraph.children!.map((node) => ({
      ...node,
      position: undefined,
    }));
    expect(withoutPositions).toEqual([
      text("see "),
      { type: "link", url, children: [text(url)] },
      text(" now"),
    ]);
  });

  it("still links a URL in the text left after one it measured", () => {
    const content = "https://x.test/*a*b and https://y.test";
    const open = content.indexOf("*");
    const close = open + 3;
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text(content.slice(0, open)), 0, open),
        at({ type: "emphasis", children: [at(text("a"), open + 1, close - 1)] }, open, close),
        at(text(content.slice(close)), close, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(
      paragraph.children!.filter((node) => node.type === "link").map((node) => node.url),
    ).toEqual(["https://x.test/*a*b", "https://y.test"]);
  });

  it("leaves what the URL cut from an emphasis as typed", () => {
    // `bareUrlEnd` gives a trailing `_` back, as it would in plain text, so the
    // closing `__` no longer closes anything and shows as typed.
    const content = "https://x.test/pkg/__init__";
    const open = content.indexOf("__");
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text(content.slice(0, open)), 0, open),
        at({ type: "strong", children: [at(text("init"), open + 2, open + 6)] }, open, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    const url = "https://x.test/pkg/__init";
    expect(paragraph.children!.map((node) => ({ ...node, position: undefined }))).toEqual([
      { type: "link", url, children: [text(url)] },
      text("__"),
    ]);
  });

  it.each([
    ["inline code", { type: "inlineCode", value: "x" }, "`x`"],
    ["a link", { type: "link", url: "https://y.test", children: [text("docs")] }, "[docs](https://y.test)"],
  ])("stops the URL before %s, which keeps its own meaning", (_label, sibling, source) => {
    const content = `https://x.test/*a*${source}`;
    const open = content.indexOf("*");
    const code = open + 3;
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text(content.slice(0, open)), 0, open),
        at({ type: "emphasis", children: [at(text("a"), open + 1, open + 2)] }, open, code),
        at(sibling as Node, code, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children!.map((node) => node.type)).toEqual(["link", "text", sibling.type]);
    expect(paragraph.children![0]!.url).toBe("https://x.test/*a");
  });

  it("stops the URL before text that isn't its source verbatim", () => {
    // `&#95;` decodes to `_`: an href built from the source would carry the
    // entity, so the URL ends where the decoded text starts.
    const content = "https://x.test/?q=*1*&#95;r=2";
    const open = content.indexOf("*");
    const close = open + 3;
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text(content.slice(0, open)), 0, open),
        at({ type: "emphasis", children: [at(text("1"), open + 1, open + 2)] }, open, close),
        at(text("_r=2"), close, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![0]!.url).toBe("https://x.test/?q=*1");
    expect(paragraph.children!.slice(1).map((node) => node.value)).toEqual(["*", "_r=2"]);
  });

  it("measures a URL whose node dropped a line's indent, from the node's end", () => {
    // The parser drops a continuation line's indent from the value, so only
    // the node's text from the URL on is compared with the body.
    const content = "see\n   https://x.test/__a__.py";
    const open = content.indexOf("__");
    const close = open + 5;
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text("see\nhttps://x.test/"), 0, open),
        at({ type: "strong", children: [at(text("a"), open + 2, open + 3)] }, open, close),
        at(text(".py"), close, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![1]).toMatchObject({ type: "link", url: "https://x.test/__a__.py" });
  });

  it("links by the value when the URL's own text isn't its source", () => {
    // `&#00095;` decodes to `_`, seven characters shorter than its source.
    // Measured anyway, the URL would be placed seven characters late in the
    // body, where a second `http://` starts, and carry the entity raw.
    const content = "http://http://x.test/&#00095;__a__.py";
    const strong = content.indexOf("__");
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text("http://http://x.test/_"), 0, strong),
        at({ type: "strong", children: [at(text("a"), strong + 2, strong + 3)] }, strong, strong + 5),
        at(text(".py"), strong + 5, content.length),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![0]).toEqual({
      type: "link",
      url: "http://http://x.test/",
      children: [text("http://http://x.test/")],
    });
  });

  it("ends the URL before an emphasis whose text ends in an entity", () => {
    // `a&amp;` reads `a&`: the decoded text is a prefix of its source, which
    // is not the same as being it.
    const content = "https://x.test/p*a&amp;*";
    const emphasis = at({ type: "emphasis", children: [at(text("a&"), 17, 23)] }, 16, 24);
    const paragraph: Node = {
      type: "paragraph",
      children: [at(text("https://x.test/p"), 0, 16), emphasis],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![0]).toMatchObject({ type: "link", url: "https://x.test/p" });
    expect(paragraph.children![1]).toBe(emphasis);
  });

  it.each([
    ["inline code", { type: "inlineCode", value: "c" }, "`c`"],
    ["a link", { type: "link", url: "https://y.test", children: [text("l")] }, "[l](https://y.test)"],
  ])("ends the URL before an emphasis holding %s", (_label, inner, source) => {
    const content = `https://x.test/*a${source}* d`;
    const close = 16 + 1 + source.length + 1;
    const emphasis = at(
      {
        type: "emphasis",
        children: [at(text("a"), 16, 17), at(inner as Node, 17, close - 1)],
      },
      15,
      close,
    );
    const paragraph: Node = {
      type: "paragraph",
      children: [at(text("https://x.test/"), 0, 15), emphasis, at(text(" d"), close, close + 2)],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![0]).toMatchObject({ type: "link", url: "https://x.test/" });
    expect(paragraph.children![1]).toBe(emphasis);
  });

  it("ends the URL before an emphasis holding a space, keeping what it nests", () => {
    const content = "https://x.test/a*b **c** d*";
    const emphasis = at(
      {
        type: "emphasis",
        children: [
          at(text("b "), 17, 19),
          at({ type: "strong", children: [at(text("c"), 21, 22)] }, 19, 24),
          at(text(" d"), 24, 26),
        ],
      },
      16,
      27,
    );
    const paragraph: Node = {
      type: "paragraph",
      children: [at(text("https://x.test/a"), 0, 16), emphasis],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![0]).toMatchObject({ type: "link", url: "https://x.test/a" });
    expect(paragraph.children![1]).toBe(emphasis);
  });

  it("takes a node's trailing punctuation into a URL it measured, once", () => {
    // `bareUrls` gives the `.` back inside the node, but the raw URL runs on
    // past it, so it belongs to the link and is not drawn again after it.
    const content = "https://x.test/a.*b*c";
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text("https://x.test/a."), 0, 17),
        at({ type: "emphasis", children: [at(text("b"), 18, 19)] }, 17, 20),
        at(text("c"), 20, 21),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children).toEqual([
      { type: "link", url: content, children: [text(content)] },
    ]);
  });

  it("stays linear when every URL stops at a space", () => {
    // Each URL's run ends at the next space; a walk that didn't stop there
    // would read every later sibling for every URL.
    const unit = "http://a*b* ";
    const content = unit.repeat(3_000);
    const children: Node[] = [at(text("http://a"), 0, 8)];
    for (let i = 0; i < content.length; i += unit.length) {
      children.push(at({ type: "emphasis", children: [at(text("b"), i + 9, i + 10)] }, i + 8, i + 11));
      const next = i + unit.length < content.length ? " http://a" : " ";
      children.push(at(text(next), i + 11, i + 11 + next.length));
    }
    const started = performance.now();
    run({ type: "root", children: [{ type: "paragraph", children }] }, content);
    expect(performance.now() - started).toBeLessThan(300);
  });

  it("stays linear on a body of URLs split at emphasis", () => {
    // `"http://a*b*"` repeated: each URL runs into the next, and a measurement
    // that rescanned the rest of the body per node took seconds at this size.
    const unit = "http://a*b*";
    const content = unit.repeat(3_640);
    const children: Node[] = [];
    for (let i = 0; i < content.length; i += unit.length) {
      children.push(at(text("http://a"), i, i + 8));
      children.push(at({ type: "emphasis", children: [at(text("b"), i + 9, i + 10)] }, i + 8, i + 11));
    }
    const started = performance.now();
    run({ type: "root", children: [{ type: "paragraph", children }] }, content);
    expect(performance.now() - started).toBeLessThan(300);
  });

  it("walks a tree far deeper than the depth cap without recursing", () => {
    // The cap runs first in both renderers, but the walk must not be the
    // thing that overflows if it ever doesn't.
    let deepest: Node = text("https://x.test");
    for (let i = 0; i < 20_000; i += 1) deepest = { type: "emphasis", children: [deepest] };
    expect(() => run({ type: "root", children: [deepest] })).not.toThrow();
  });
});
