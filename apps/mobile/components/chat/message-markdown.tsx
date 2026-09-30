import {
  createContext,
  useContext,
  useMemo,
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
  opensTooManyContainers,
  remarkBareUrls,
  remarkDepthCap,
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
 * `rehypeTextFlow` lays blocks out as line breaks instead.
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
  /** The body ends in a code block, so the trailing markers take a line of their own. */
  endsInCodeBlock: boolean;
}

/**
 * The slice of hast the layout needs, written out rather than imported: `hast`
 * reaches this app only through react-markdown, for the reason
 * `markdown-depth-cap.ts` in `@repo/chat-core` gives about mdast.
 */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const ALLOWED = new Set(MESSAGE_MARKDOWN_ELEMENTS);

/** The elements web draws as blocks. Everything else flows inline. */
const BLOCKS = new Set(["p", "pre"]);

/** Breaks between two blocks: web's `pre-wrap` shows a paragraph gap, one blank line. */
const MAX_BREAKS = 2;

/** The characters a node reads as. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/** A text node holding only the line breaks hast puts between blocks. */
function isSeparator(node: HastNode): boolean {
  return node.type === "text" && /^\n+$/.test(node.value ?? "");
}

function isElement(node: HastNode | undefined, tagName: string): boolean {
  return node?.type === "element" && node.tagName === tagName;
}

/**
 * The allowlist, applied as react-markdown's own pass applies it
 * (`allowedElements` with `unwrapDisallowed`, raw HTML as its text), but here,
 * so the layout below sees the tree that will render. react-markdown applies
 * both again afterwards and finds nothing left to do.
 *
 * It also drops the `"\n"` that hast puts after every `br`. Kept, that
 * newline breaks the line a second time in a `Text`, as it does in web's
 * `pre-wrap` body (#2934).
 *
 * Recursive, which is safe because `remarkDepthCap` already ran: the tree is at
 * most `MAX_MESSAGE_MARKDOWN_DEPTH` deep.
 */
function applyAllowlist(nodes: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  for (const node of nodes) {
    if (node.type === "raw") {
      out.push({ type: "text", value: node.value ?? "" });
    } else if (node.type === "element") {
      const children = applyAllowlist(node.children ?? []);
      if (ALLOWED.has(node.tagName ?? "")) out.push({ ...node, children });
      else out.push(...children);
    } else {
      out.push(node);
    }
  }
  return out.filter(
    (node, index) => !(isSeparator(node) && isElement(out[index - 1], "br")),
  );
}

/**
 * The body's top level as one line of flow, with each block boundary written
 * out as the line breaks web's layout shows there.
 *
 * On web the body is `pre-wrap` with block paragraphs and code, so each
 * `"\n"` that hast puts between blocks shows as a line of its own. A block
 * ends its line, and each separator adds one more. So two paragraphs show a
 * blank line between them, a list's items one line each, and a paragraph that
 * follows a heading starts on the next line. That count is capped at one blank
 * line. Separators at the start or end of the body are dropped, so a body
 * that opens with a list or a quote doesn't open with an empty line, as it
 * does on web (#2934).
 */
function layOut(nodes: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  let separators = 0;
  let afterBlock = false;
  for (const node of nodes) {
    if (isSeparator(node)) {
      separators += (node.value ?? "").length;
      continue;
    }
    const block = node.type === "element" && BLOCKS.has(node.tagName ?? "");
    if (out.length > 0) {
      let breaks = separators + (afterBlock ? 1 : 0);
      if (block || afterBlock) breaks = Math.max(breaks, 1);
      breaks = Math.min(breaks, MAX_BREAKS);
      if (breaks > 0) out.push({ type: "text", value: "\n".repeat(breaks) });
    }
    out.push(node);
    separators = 0;
    afterBlock = block;
  }
  return out;
}

/** The body's links in reading order, each as its `a` component will judge it. */
function collectLinks(root: HastNode): MessageLink[] {
  const links: MessageLink[] = [];
  const visit = (node: HastNode) => {
    if (isElement(node, "a")) {
      const href = defaultUrlTransform(String(node.properties?.href ?? ""));
      if (isOpenableHref(href)) links.push({ text: textOf(node) || href, href });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return links;
}

interface TextFlowResult {
  links: MessageLink[];
  endsInCodeBlock: boolean;
}

/** The rehype pass that shapes the tree for one `Text`. It must run last. */
function rehypeTextFlow(result: TextFlowResult) {
  return (root: HastNode): void => {
    root.children = layOut(applyAllowlist(root.children ?? []));
    result.links = collectLinks(root);
    result.endsInCodeBlock = isElement(
      root.children[root.children.length - 1],
      "pre",
    );
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
  // `opensTooManyContainers` (#2209).
  const flatten = opensTooManyContainers(content);
  const result: TextFlowResult = { links: [], endsInCodeBlock: false };
  const body = Markdown({
    children: flatten ? "" : content,
    // The depth cap goes first: every pass after it recurses once per level.
    remarkPlugins: [
      [remarkDepthCap, { content, flatten }],
      remarkBreaks,
      remarkBareUrls,
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
  const value = {
    ...context,
    bold: context.bold || !!bold,
    italic: context.italic || !!italic,
  };
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
  a: function Link({ href, children }) {
    const { styles, onLongPress } = useMarkdownContext();
    // `collectLinks` applies the same test to the same href, so the row's
    // accessibility actions name exactly the links drawn here.
    if (!href || !isOpenableHref(href)) return <>{children}</>;
    return (
      <Text
        accessibilityRole="link"
        onPress={() => void openMessageLink(href)}
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
   * `(edited)` and Pinned, nested after the body so they sit on its last line
   * (`components.md` §11 § What rides the row), or under a closing code block.
   */
  trailing?: ReactNode;
  onLongPress?: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const context = useMemo(
    () => ({ styles, onLongPress, bold: false, italic: false }),
    [styles, onLongPress],
  );
  return (
    <MarkdownContext.Provider value={context}>
      <Text style={style}>
        {parsed.body}
        {trailing && parsed.endsInCodeBlock ? "\n" : null}
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
