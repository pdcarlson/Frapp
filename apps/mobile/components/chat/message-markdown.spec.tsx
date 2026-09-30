/** @vitest-environment jsdom */
import React, { act } from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { MAX_MESSAGE_MARKDOWN_DEPTH } from "@repo/chat-core/markdown";
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

describe("MessageMarkdown: trailing markers", () => {
  it("ride the body's last line", () => {
    const tree = render("**hi**", { trailing: " (edited)" });
    expect(drawnText(texts(tree)[0]!)).toBe("hi (edited)");
  });

  it("take a line of their own after a closing code block, as on web", () => {
    const tree = render("```\ncode\n```", { trailing: "(edited)" });
    expect(drawnText(texts(tree)[0]!)).toBe("code\n(edited)");
  });
});
