import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  StyleSheet,
  Text,
  type AccessibilityActionInfo,
  type StyleProp,
  type TextStyle,
} from "react-native";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import { isOpenableHref } from "@repo/chat-core/links";
import {
  MESSAGE_MARKDOWN_ELEMENTS,
  applyMessageAllowlist,
  endsInOwnLineBlock,
  isElement,
  layOutMessageFlow,
  remarkBareUrls,
  remarkDepthCap,
  skipsMarkdownParse,
  textOf,
  type HastNode,
} from "@repo/chat-core/markdown";
import { SignetTokens } from "@repo/theme/signet";
import { openMessageLink } from "@/lib/chat/open-link";
import {
  fontFamilyFor,
  italicFontFamilyFor,
  MONO_FONT_FAMILY,
  useFrappTheme,
} from "@/lib/theme";

/**
 * A message body with its markdown drawn (#2861).
 *
 * The pipeline is web's (`apps/web/components/chat/renderers/message-markdown.tsx`):
 * react-markdown with `remark-breaks`, behind the #2209 depth cap and the
 * element allowlist from `@repo/chat-core/markdown`. So a body gets the same
 * bold, italic, code and links on both clients, parsed by the same parser.
 * Mobile adds `remarkBareUrls`, because it has linked a bare URL since #2775
 * and web doesn't yet (#2862).
 *
 * **The whole body is one `Text`.** Bold, italic, code and links are `Text`s
 * nested in it, so the body keeps what one `Text` gives it:
 * - `(edited)` and Pinned sit on its last line.
 * - The row's long-press reaches every character.
 * - The screen reader reads it as one element, which carries the links as
 *   named actions (`linkA11yActions`).
 *
 * A paragraph or a code block can't be a block box inside a `Text`, so
 * `rehypeTextFlow` lays blocks out as line breaks instead, with the layout web
 * shares (`layOutMessageFlow`).
 */

/** A link in a body, in reading order: what it reads as, and where it goes. */
export interface MessageLink {
  text: string;
  href: string;
}

/** A body parsed once, for its render and for its row's accessibility actions. */
export interface ParsedMessageMarkdown {
  body: ReactElement;
  /** Every link `body` draws, in the order it draws them. */
  links: MessageLink[];
  /**
   * The body draws no text at all: `---`, a lone `*` or `#`, an image. The
   * row then draws no text line, as for an attachment-only message.
   */
  empty: boolean;
  /**
   * The body ends in a block that keeps lines of its own (a list, a quote, a
   * code block), so the trailing markers take a line of their own under it
   * rather than breaking it (`components.md` §11 § What rides the row). A
   * heading or raw HTML reads as a line of text, and they trail it, as on web.
   */
  trailingOnOwnLine: boolean;
}

/**
 * An `a` element as the link it draws, or `null` when it draws none: its
 * target is not openable (`isOpenableHref`, after react-markdown's own
 * `urlTransform`), or it has no text to tap (`[![logo](x)](url)`, whose image
 * the allowlist drops). The `a` component and `collectLinks` both decide
 * through this, so a screen reader is offered exactly the links drawn.
 */
function drawnLink(node: HastNode): MessageLink | null {
  const href = defaultUrlTransform(String(node.properties?.href ?? ""));
  // The action's label reads a line break inside a link as a space.
  const text = textOf(node).replace(/\s+/g, " ").trim();
  return text && isOpenableHref(href) ? { text, href } : null;
}

/** The body's links in reading order. */
function collectLinks(root: HastNode): MessageLink[] {
  const links: MessageLink[] = [];
  const visit = (node: HastNode) => {
    const link = isElement(node, "a") ? drawnLink(node) : null;
    if (link) links.push(link);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return links;
}

type TextFlowResult = Omit<ParsedMessageMarkdown, "body">;

const ALLOWED: ReadonlySet<string> = new Set(MESSAGE_MARKDOWN_ELEMENTS);

/**
 * The rehype pass that shapes the tree for one `Text`: the shared line layout
 * (`markdown-flow.ts` in `@repo/chat-core`, which web runs too), plus what the
 * row needs from the parse. It must run last.
 */
function rehypeTextFlow(result: TextFlowResult) {
  return (root: HastNode): void => {
    // Read before the allowlist unwraps the blocks it is asking about.
    result.trailingOnOwnLine = endsInOwnLineBlock(root.children ?? []);
    root.children = layOutMessageFlow(
      applyMessageAllowlist(root.children ?? [], ALLOWED),
    );
    result.links = collectLinks(root);
    result.empty = textOf(root).trim() === "";
  };
}

/**
 * Parses a body. Pure in `content`, so a row memoizes it on the content alone:
 * the components read the row's styles and long-press from context at render.
 *
 * `Markdown` is react-markdown's component called as a function. It runs no
 * hooks, and calling it here, not rendering it, is what lets the links
 * collected during the parse reach the row's accessibility actions.
 */
export function parseMessageMarkdown(content: string): ParsedMessageMarkdown {
  // Decided from the source, before remark sees it: see
  // `skipsMarkdownParse` (#2209, #2664).
  const flatten = skipsMarkdownParse(content);
  const result: TextFlowResult = {
    links: [],
    empty: false,
    trailingOnOwnLine: false,
  };
  const body = Markdown({
    children: flatten ? "" : content,
    remarkPlugins: [
      // The depth cap goes first: every pass after it recurses once per level.
      [remarkDepthCap, { content, flatten }],
      // Before `remark-breaks`, which leaves the text nodes it splits without
      // the source positions a bare URL is measured by.
      [remarkBareUrls, { content }],
      remarkBreaks,
    ],
    rehypePlugins: [[rehypeTextFlow, result]],
    allowedElements: MESSAGE_MARKDOWN_ELEMENTS,
    unwrapDisallowed: true,
    components: COMPONENTS,
  });
  return { body, ...result };
}

interface MarkdownContextValue {
  styles: ReturnType<typeof createStyles>;
  onLongPress?: () => void;
  bold: boolean;
  italic: boolean;
}

const MarkdownContext = createContext<MarkdownContextValue | null>(null);

function useMarkdownContext(): MarkdownContextValue {
  const context = useContext(MarkdownContext);
  if (!context) throw new Error("A markdown element rendered outside MessageMarkdown");
  return context;
}

/**
 * The Figtree face for a run. A nested `Text` inherits its parent's family,
 * so `em` inside `strong` has to name the bold italic itself, which is why
 * emphasis is tracked in context rather than left to inheritance.
 */
function faceFor(bold: boolean, italic: boolean): string {
  const weight = bold ? 700 : 400;
  return italic ? italicFontFamilyFor(weight) : fontFamilyFor(weight);
}

function Emphasis({
  bold,
  italic,
  children,
}: {
  bold?: boolean;
  italic?: boolean;
  children?: ReactNode;
}) {
  const context = useMarkdownContext();
  const value = useMemo(
    () => ({
      ...context,
      bold: context.bold || !!bold,
      italic: context.italic || !!italic,
    }),
    [context, bold, italic],
  );
  return (
    <MarkdownContext.Provider value={value}>
      <Text style={{ fontFamily: faceFor(value.bold, value.italic) }}>
        {children}
      </Text>
    </MarkdownContext.Provider>
  );
}

/**
 * Code in the system mono stack. Mono is a system family, which resolves a
 * weight and a slant itself, so emphasis around code is `fontWeight` and
 * `fontStyle` here (`typeRole` says why that is wrong for Figtree only).
 */
function Code({ children }: { children?: ReactNode }) {
  const { styles, bold, italic } = useMarkdownContext();
  return (
    <Text
      style={[
        styles.code,
        bold ? styles.codeBold : null,
        italic ? styles.codeItalic : null,
      ]}
    >
      {children}
    </Text>
  );
}

const COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => <Emphasis bold>{children}</Emphasis>,
  em: ({ children }) => <Emphasis italic>{children}</Emphasis>,
  // Inline code only. A code block's `code` sits inside `pre`, which draws the
  // block from its text and never renders its children.
  code: ({ children }) => <Code>{children}</Code>,
  // hast ends a block's text with a newline; the layout breaks the line itself.
  pre: ({ node }) => (
    <Code>{textOf((node ?? { type: "root" }) as HastNode).replace(/\n$/, "")}</Code>
  ),
  br: () => "\n",
  a: function Link({ node, children }) {
    const { styles, onLongPress } = useMarkdownContext();
    // The same decision `collectLinks` makes, so the row's accessibility
    // actions name exactly the links drawn here.
    const link = node ? drawnLink(node as HastNode) : null;
    if (!link) return <>{children}</>;
    return (
      <Text
        accessibilityRole="link"
        onPress={() => void openMessageLink(link.href)}
        // A nested `Text` with `onPress` claims the touch, so it forwards the
        // row's long-press.
        onLongPress={onLongPress}
        style={styles.link}
      >
        {children}
      </Text>
    );
  },
};

/**
 * Draws a parsed body. A link inherits the body's color and type and is set
 * apart by its underline alone, which reads in a plain body and in a muted
 * one still sending.
 */
export function MessageMarkdown({
  parsed,
  style,
  trailing,
  onLongPress,
}: {
  /** `parseMessageMarkdown(message.content)`, memoized by the caller. */
  parsed: ParsedMessageMarkdown;
  style: StyleProp<TextStyle>;
  /**
   * `(edited)` and Pinned, nested after the body so they sit on its last line,
   * or on a line of their own after a last block that isn't a paragraph
   * (`components.md` §11 § What rides the row).
   */
  trailing?: ReactNode;
  onLongPress?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  // The row's long-press is a new closure on every render of the thread. Read
  // through a ref, it leaves the context as it was, so React can skip the
  // memoized body instead of re-rendering every run in it.
  const longPress = useRef(onLongPress);
  useLayoutEffect(() => {
    longPress.current = onLongPress;
  });
  const hasLongPress = onLongPress !== undefined;
  const context = useMemo<MarkdownContextValue>(
    () => ({
      styles,
      onLongPress: hasLongPress ? () => longPress.current?.() : undefined,
      bold: false,
      italic: false,
    }),
    [styles, hasLongPress],
  );
  return (
    <MarkdownContext.Provider value={context}>
      <Text style={style}>
        {parsed.body}
        {trailing && parsed.trailingOnOwnLine ? "\n" : null}
        {trailing}
      </Text>
    </MarkdownContext.Provider>
  );
}

const OPEN_LINK_ACTION_PREFIX = "openLink:";

/**
 * The links in a body as named accessibility actions.
 *
 * The body sits inside an accessible container (the message's actions ride
 * it, see `messageActionsA11yProps`), and an accessible container is one
 * element to a screen reader, so the link `Text`s inside it are not
 * separately reachable. Each link becomes an action instead, "Open <link>",
 * in the iOS actions rotor and TalkBack's actions menu.
 */
export function linkA11yActions(
  links: MessageLink[],
): AccessibilityActionInfo[] {
  return links.map((link, index) => ({
    name: `${OPEN_LINK_ACTION_PREFIX}${index}`,
    label: `Open ${link.text}`,
  }));
}

/** Runs a `linkA11yActions` action; `false` when the name is not one of them. */
export function runLinkA11yAction(
  links: MessageLink[],
  actionName: string,
): boolean {
  if (!actionName.startsWith(OPEN_LINK_ACTION_PREFIX)) return false;
  const link = links[Number(actionName.slice(OPEN_LINK_ACTION_PREFIX.length))];
  if (!link) return false;
  void openMessageLink(link.href);
  return true;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    link: {
      textDecorationLine: "underline",
    },
    // Mono takes the size of the role it sits in (foundations.md §7), so only
    // the family changes. The fill sets code apart the way web's tint does.
    code: {
      fontFamily: MONO_FONT_FAMILY,
      backgroundColor: tokens.color.surface.popover,
    },
    codeBold: { fontWeight: "700" },
    codeItalic: { fontStyle: "italic" },
  });
}
