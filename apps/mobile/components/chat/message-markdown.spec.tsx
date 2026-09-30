/** @vitest-environment jsdom */
import React, { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_MARKDOWN_DEPTH, skipsMarkdownParse } from "@repo/chat-core/markdown";
import { FrappThemeProvider, MONO_FONT_FAMILY } from "@/lib/theme";
import { drawnText } from "@/test/screen-text";
import {
  linkA11yActions,
  MessageMarkdown,
  parseMessageMarkdown,
  runLinkA11yAction,
} from "./message-markdown";

function render(
  content: string,
  props: { trailing?: React.ReactNode; onLongPress?: () => void } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MessageMarkdown
          parsed={parseMessageMarkdown(content)}
          style={{ color: "body" }}
          {...props}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const texts = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "Text");

/** What the body reads as: its outermost `Text`, everything nested included. */
const drawn = (content: string) => drawnText(texts(render(content))[0]!);

function fontOf(node: ReactTestInstance): string | undefined {
  const style = [node.props.style].flat(Infinity) as Array<
    Record<string, unknown> | null
  >;
  return style.reduce<string | undefined>(
    (family, part) => (part?.fontFamily as string | undefined) ?? family,
    undefined,
  );
}

/** Each nested run with its own face, as `[face, text]`. */
const runs = (content: string) =>
  texts(render(content))
    .slice(1)
    .map((node) => [fontOf(node), drawnText(node)]);

const links = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Text" &&
      node.props.accessibilityRole === "link",
  );

describe("MessageMarkdown: the formatting set (#2861)", () => {
  it("draws bold, italic and code without their markers", () => {
    expect(drawn("**bold** and *it* and `code`")).toBe("bold and it and code");
  });

  it("draws each in its own Figtree face, or mono for code", () => {
    expect(runs("**b** *i* ***bi*** `c`")).toEqual([
      ["Figtree_700Bold", "b"],
      ["Figtree_400Regular_Italic", "i"],
      ["Figtree_400Regular_Italic", "bi"],
      ["Figtree_700Bold_Italic", "bi"],
      [MONO_FONT_FAMILY, "c"],
    ]);
  });

  it("names the bold italic face for emphasis nested either way round", () => {
    expect(runs("**a *b***")).toContainEqual(["Figtree_700Bold_Italic", "b"]);
    expect(runs("*a **b***")).toContainEqual(["Figtree_700Bold_Italic", "b"]);
  });

  it("reads `__x__` as bold and `_x_` as italic, as CommonMark and web do", () => {
    expect(runs("__u__ _i_")).toEqual([
      ["Figtree_700Bold", "u"],
      ["Figtree_400Regular_Italic", "i"],
    ]);
  });

  it("gives code inside bold a bold weight, since mono is a system family", () => {
    const [, code] = texts(render("**`c`**")).slice(1);
    expect([code!.props.style].flat()).toContainEqual({ fontWeight: "700" });
  });

  it("draws a code block as its own lines, without the fence", () => {
    const content = "intro\n```js\nline 1\nline 2\n```\nafter";
    expect(drawn(content)).toBe("intro\n\nline 1\nline 2\n\nafter");
    expect(runs(content)).toEqual([[MONO_FONT_FAMILY, "line 1\nline 2"]]);
  });

  it("shows raw HTML as the characters typed", () => {
    expect(drawn("<b>hi</b> & <script>x</script>")).toBe(
      "<b>hi</b> & <script>x</script>",
    );
  });

  it("decodes entities as web does", () => {
    expect(drawn("&amp; &copy; &#64;")).toBe("& © @");
  });
});

describe("MessageMarkdown: lines, laid out as web's body shows them", () => {
  it.each([
    ["a single newline breaks the line once (#2934)", "one\ntwo", "one\ntwo"],
    ["a blank line is one blank line", "one\n\ntwo", "one\n\ntwo"],
    ["extra blank lines are still one", "one\n\n\n\ntwo", "one\n\ntwo"],
    ["a hard break breaks once", "one  \ntwo", "one\ntwo"],
    ["a backslash break breaks once", "one\\\ntwo", "one\ntwo"],
  ])("%s", (_label, content, expected) => {
    expect(drawn(content)).toBe(expected);
  });

  it.each([
    ["a list, one item a line", "- a\n- b", "a\nb"],
    ["an ordered list", "1. one\n2. two\n\nend", "one\ntwo\n\nend"],
    ["a block quote", "> quoted\n> more\n\nafter", "quoted\nmore\n\nafter"],
    ["a heading", "# Big\ntext", "Big\ntext"],
    ["a list after a paragraph", "text\n\n- a\n- b", "text\n\na\nb"],
    ["a quote at the end", "text\n\n> end", "text\n\nend"],
  ])("unwraps %s, keeping its text", (_label, content, expected) => {
    expect(drawn(content)).toBe(expected);
  });

  it("drops an image and a divider, as web's allowlist does", () => {
    expect(drawn("a ![alt](https://x.test/i.png) b")).toBe("a  b");
    expect(drawn("above\n\n---\n\nbelow")).toBe("above\n\nbelow");
  });
});

describe("MessageMarkdown: links", () => {
  it("links a bare URL, a markdown link, an autolink and an email", async () => {
    const WebBrowser = await import("expo-web-browser");
    const content =
      "see https://frapp.live/a, [docs](https://x.test/d) <https://x.test/e> <a@x.test>";
    const parsed = parseMessageMarkdown(content);
    expect(parsed.links).toEqual([
      { text: "https://frapp.live/a", href: "https://frapp.live/a" },
      { text: "docs", href: "https://x.test/d" },
      { text: "https://x.test/e", href: "https://x.test/e" },
      { text: "a@x.test", href: "mailto:a@x.test" },
    ]);

    const tree = render(content);
    const found = links(tree);
    expect(found.map(drawnText)).toEqual(parsed.links.map((link) => link.text));
    vi.mocked(WebBrowser.openBrowserAsync).mockClear();
    act(() => found[1]!.props.onPress());
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://x.test/d");
  });

  it.each([
    ["an unsafe scheme", "[click](javascript:alert(1))", "click"],
    ["a protocol-relative target", "[phish](//attacker.example)", "phish"],
    ["a relative target a phone can't resolve", "[site](example.com)", "site"],
  ])("draws %s as its label alone", (_label, content, text) => {
    const tree = render(content);
    expect(links(tree)).toHaveLength(0);
    expect(parseMessageMarkdown(content).links).toEqual([]);
    expect(drawnText(texts(tree)[0]!)).toBe(text);
  });

  it("never links a URL in code", () => {
    const content = "run `curl https://x.test` or\n```\nhttps://y.test\n```";
    expect(links(render(content))).toHaveLength(0);
    expect(parseMessageMarkdown(content).links).toEqual([]);
  });

  it("does not link a URL twice when it is a link's label", () => {
    const content = "[https://shown.test](https://real.test)";
    expect(parseMessageMarkdown(content).links).toEqual([
      { text: "https://shown.test", href: "https://real.test" },
    ]);
    expect(links(render(content))).toHaveLength(1);
  });

  it.each([
    ["an `__x__` pair", "see https://x.test/pkg/__init__.py now", "https://x.test/pkg/__init__.py"],
    ["a `*x*` pair", "https://x.test/search?q=a*b*c.", "https://x.test/search?q=a*b*c"],
    ["an `_x_` pair after a slash", "https://x.test/_next/_x_/y", "https://x.test/_next/_x_/y"],
  ])("links a bare URL holding %s whole, as typed", (_label, content, url) => {
    expect(parseMessageMarkdown(content).links).toEqual([{ text: url, href: url }]);
    expect(links(render(content)).map(drawnText)).toEqual([url]);
  });

  it.each([
    ["after a line break", "line one\nhttps://x.test/pkg/__init__.py"],
    ["after a trailing space and a line break", "see \nhttps://x.test/pkg/__init__.py"],
    ["on an indented continuation line", "see\n   https://x.test/pkg/__init__.py"],
    ["in a quote's second line", "> see\n> https://x.test/pkg/__init__.py"],
    ["in a list item's second line", "- see\n  https://x.test/pkg/__init__.py"],
  ])("links a split URL %s whole", (_label, content) => {
    // Pins `remarkBareUrls` ahead of `remark-breaks`, whose split text nodes
    // carry no positions to measure by.
    expect(parseMessageMarkdown(content).links.map((link) => link.href)).toEqual([
      "https://x.test/pkg/__init__.py",
    ]);
  });

  it.each([
    ["inline code", "https://x.test/`x`", ["https://x.test/"], 1],
    ["a link", "https://x.test/[docs](https://y.test)", ["https://x.test/", "https://y.test"], 0],
  ])("ends a bare URL before %s, which keeps its own meaning", (_label, content, hrefs, code) => {
    expect(parseMessageMarkdown(content).links.map((link) => link.href)).toEqual(hrefs);
    const tree = render(content);
    expect(
      texts(tree).filter((node) => fontOf(node) === MONO_FONT_FAMILY),
    ).toHaveLength(code);
  });

  it("leaves what a URL cut from an emphasis as typed", () => {
    const content = "https://x.test/pkg/__init__ is new";
    expect(parseMessageMarkdown(content).links.map((link) => link.href)).toEqual([
      "https://x.test/pkg/__init",
    ]);
    expect(drawn(content)).toBe(content);
  });

  it("ends a URL before an emphasis ending in an entity, which draws decoded", () => {
    const content = "https://x.test/p*a&amp;*";
    expect(parseMessageMarkdown(content).links.map((link) => link.href)).toEqual([
      "https://x.test/p",
    ]);
    expect(drawn(content)).toBe("https://x.test/pa&");
  });

  it("links the URL after one it had to measure on the raw body", () => {
    expect(
      parseMessageMarkdown("https://x.test/__a__.py and https://y.test").links.map(
        (link) => link.href,
      ),
    ).toEqual(["https://x.test/__a__.py", "https://y.test"]);
  });


  it("names a link across a line break with a space, as a reader hears it", () => {
    const content = "[click\nhere](https://x.test)";
    expect(parseMessageMarkdown(content).links).toEqual([
      { text: "click here", href: "https://x.test" },
    ]);
    expect(drawnText(links(render(content))[0]!)).toBe("click\nhere");
  });

  it("neither draws nor offers a link with nothing to tap", () => {
    const content = "[![logo](https://x.test/l.png)](https://y.test)";
    expect(parseMessageMarkdown(content).links).toEqual([]);
    expect(links(render(content))).toHaveLength(0);
  });

  it("links inside bold, and the link keeps the bold face", () => {
    const tree = render("**https://x.test**");
    const [link] = links(tree);
    let host = link!.parent;
    while (host && (host.type as unknown) !== "Text") host = host.parent;
    expect(host?.props.style).toEqual({ fontFamily: "Figtree_700Bold" });
  });

  it("forwards the row's long-press, since a link claims the touch", () => {
    const onLongPress = vi.fn();
    const [link] = links(render("https://x.test", { onLongPress }));
    act(() => link!.props.onLongPress());
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("forwards the row's current long-press after the row re-renders", () => {
    // The thread hands every render a new closure; the body reads it through
    // a ref rather than rebuilding its context.
    const first = vi.fn();
    const second = vi.fn();
    const parsed = parseMessageMarkdown("**see** https://x.test");
    const draw = (onLongPress: () => void) => (
      <FrappThemeProvider>
        <MessageMarkdown parsed={parsed} style={null} onLongPress={onLongPress} />
      </FrappThemeProvider>
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(draw(first));
    });
    act(() => tree.update(draw(second)));
    act(() => links(tree)[0]!.props.onLongPress());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("gives a link no long-press when the row has none", () => {
    const [link] = links(render("https://x.test"));
    expect(link!.props.onLongPress).toBeUndefined();
  });

  it("offers each link as a named accessibility action that opens it", async () => {
    const WebBrowser = await import("expo-web-browser");
    const { links: found } = parseMessageMarkdown(
      "[docs](https://x.test/d) and https://x.test/e",
    );
    expect(linkA11yActions(found)).toEqual([
      { name: "openLink:0", label: "Open docs" },
      { name: "openLink:1", label: "Open https://x.test/e" },
    ]);
    vi.mocked(WebBrowser.openBrowserAsync).mockClear();
    expect(runLinkA11yAction(found, "openLink:1")).toBe(true);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://x.test/e");
    expect(runLinkA11yAction(found, "openLink:2")).toBe(false);
    expect(runLinkA11yAction(found, "longpress")).toBe(false);
  });
});

describe("MessageMarkdown: the #2209 depth cap", () => {
  it("draws a line of too many containers as the raw text, without parsing", () => {
    const content = "> ".repeat(MAX_MESSAGE_MARKDOWN_DEPTH + 1) + "**hi**";
    expect(drawn(content)).toBe(content);
  });

  it("skips the parse for a list-marker line at the length cap", () => {
    // remark's parse is quadratic in one line's list markers: this body took
    // 6.8 s in Node when it reached the parser (`markdown-depth-cap.ts`). The
    // cap after the parse would draw the same text, so only the time shows
    // whether `opensTooManyContainers` skipped it.
    const content = "- ".repeat(4_999) + "hi";
    const started = performance.now();
    const parsed = parseMessageMarkdown(content);
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(parsed.links).toEqual([]);
    expect(drawn(content)).toBe(content);
  });

  it("draws emphasis nested past the cap as the raw text", () => {
    // Alternating openers, closed in reverse: no line of container markers,
    // so only the cap after the parse catches it.
    const levels = MAX_MESSAGE_MARKDOWN_DEPTH + 8;
    const markers = Array.from({ length: levels }, (_, i) => (i % 2 ? "_" : "*"));
    const content =
      markers.map((marker) => `${marker}a `).join("") +
      "x" +
      [...markers].reverse().map((marker) => ` a${marker}`).join("");
    expect(drawn(content)).toBe(content);
    expect(texts(render(content))).toHaveLength(1);
  });

  it("still formats a body nested within the cap", () => {
    const content = "> ".repeat(MAX_MESSAGE_MARKDOWN_DEPTH - 3) + "**bold**";
    expect(drawn(content)).toBe("bold");
  });
});

/**
 * #2664. Bodies within the length cap that remark took 0.2–1.8 s to parse in
 * Node, and several times that on Hermes, which has no JIT: every member who
 * opened the channel froze for it. `skipsMarkdownParse` now reads them off the
 * source and they draw as their raw text. The time bound is loose so it can't
 * flake on CI.
 */
describe("MessageMarkdown: bodies too costly to parse", () => {
  const nestedOpeners = (() => {
    let open = "";
    let close = "";
    for (let i = 0; i < 1600; i += 1) {
      const marker = i % 2 ? "_" : "*";
      open += `${marker}a `;
      close = ` a${marker}` + close;
    }
    return open + "x" + close;
  })();

  it.each([
    ["an underscore run", "_".repeat(4999) + "a" + "_".repeat(4999)],
    ["a strong run", "**".repeat(2499) + "a" + "**".repeat(2499)],
    ["open brackets closed by links", "[".repeat(3000) + "a" + "](u)".repeat(1000)],
    ["alternating openers closed in reverse", nestedOpeners],
    ["brackets", "[".repeat(4999) + "a" + "]".repeat(4999)],
    ["star-a pairs", "*a".repeat(2400) + "x" + "a*".repeat(2400)],
    ["nested images", "![".repeat(2499) + "a" + "](u)".repeat(1249)],
  ])("draws %s as the raw text, without the slow parse", (_label, content) => {
    expect(content.length).toBeLessThanOrEqual(10_000);
    const started = performance.now();
    const parsed = parseMessageMarkdown(content);
    expect(performance.now() - started).toBeLessThan(500);
    expect(parsed.links).toEqual([]);
    expect(drawn(content)).toBe(content);
  });

  it("parses a body just inside the budget quickly", () => {
    // Among the slowest shapes the budgets allow: openers closed in reverse,
    // padded with entities, which multiply the events the emphasis resolver
    // walks. It goes through the parse (the depth cap then flattens it).
    const markers = Array.from({ length: 38 }, (_, i) => (i % 2 ? "_" : "*"));
    const open = markers.map((marker) => `${marker}a `).join("");
    const close = [...markers].reverse().map((marker) => ` a${marker}`).join("");
    const pad = "&amp;x".repeat(Math.floor((9_000 - open.length - close.length) / 6));
    const content = open + pad + close;
    expect(skipsMarkdownParse(content)).toBe(false);

    const started = performance.now();
    parseMessageMarkdown(content);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("MessageMarkdown: trailing markers", () => {
  it("ride the body's last line", () => {
    const tree = render("**hi**", { trailing: " (edited)" });
    expect(drawnText(texts(tree)[0]!)).toBe("hi (edited)");
  });

  it.each([
    ["a code block", "```\ncode\n```", "code"],
    ["a list", "- a\n- b", "a\nb"],
    ["a numbered list", "1. a\n2. b", "a\nb"],
    ["a quote", "> quoted", "quoted"],
    ["a list, past a divider", "- a\n\n---", "a"],
    ["a code block, past a divider", "```\ncode\n```\n\n***", "code"],
    ["a list, past an image", "- a\n\n![x](https://x.test/i.png)", "a"],
  ])("take a line of their own after %s, as §11 says", (_label, content, body) => {
    const tree = render(content, { trailing: "(edited)" });
    expect(drawnText(texts(tree)[0]!)).toBe(`${body}\n(edited)`);
  });

  it.each([
    ["a heading", "# Release notes", "Release notes"],
    ["raw HTML", "<div>x</div>", "<div>x</div>"],
  ])("trail %s on its line, as on web", (_label, content, body) => {
    const tree = render(content, { trailing: " (edited)" });
    expect(drawnText(texts(tree)[0]!)).toBe(`${body} (edited)`);
  });

  it("stay on the line after a paragraph that follows a list", () => {
    const tree = render("- a\n\nend", { trailing: " (edited)" });
    expect(drawnText(texts(tree)[0]!)).toBe("a\n\nend (edited)");
  });
});

describe("parseMessageMarkdown: a body that draws nothing", () => {
  it.each([
    ["a divider", "---"],
    ["a starred divider", "***"],
    ["a lone list marker", "*"],
    ["an empty heading", "#"],
    ["an image", "![shot](https://x.test/a.png)"],
  ])("marks %s empty, so the row draws no text line", (_label, content) => {
    expect(parseMessageMarkdown(content).empty).toBe(true);
  });

  it("does not mark text, code or a lone link empty", () => {
    for (const content of ["hi", "`x`", "```\nx\n```", "https://x.test"]) {
      expect(parseMessageMarkdown(content).empty).toBe(false);
    }
  });
});
