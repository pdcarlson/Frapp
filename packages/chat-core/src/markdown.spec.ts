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
const run = (tree: Node) => remarkBareUrls()(tree as never);

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

  it("walks a tree far deeper than the depth cap without recursing", () => {
    // The cap runs first in both renderers, but the walk must not be the
    // thing that overflows if it ever doesn't.
    let deepest: Node = text("https://x.test");
    for (let i = 0; i < 20_000; i += 1) deepest = { type: "emphasis", children: [deepest] };
    expect(() => run({ type: "root", children: [deepest] })).not.toThrow();
  });
});
