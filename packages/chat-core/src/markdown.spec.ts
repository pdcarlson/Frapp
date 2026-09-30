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

  it("keeps the parse's split when the text is not its source verbatim", () => {
    // An entity: the value no longer matches the body, so the URL is linked
    // by the value it has.
    const content = "https://x.test/&amp;__a__";
    const paragraph: Node = {
      type: "paragraph",
      children: [
        at(text("https://x.test/&"), 0, 20),
        at({ type: "strong", children: [at(text("a"), 22, 23)] }, 20, 25),
      ],
    };
    run({ type: "root", children: [paragraph] }, content);
    expect(paragraph.children![0]).toEqual({
      type: "link",
      url: "https://x.test/&",
      children: [text("https://x.test/&")],
    });
  });

  it("walks a tree far deeper than the depth cap without recursing", () => {
    // The cap runs first in both renderers, but the walk must not be the
    // thing that overflows if it ever doesn't.
    let deepest: Node = text("https://x.test");
    for (let i = 0; i < 20_000; i += 1) deepest = { type: "emphasis", children: [deepest] };
    expect(() => run({ type: "root", children: [deepest] })).not.toThrow();
  });
});
