/**
 * Chat's markdown, for both clients (#2861).
 *
 * Web renders a message body with react-markdown (`message-markdown.tsx` in
 * `apps/web`) and mobile renders it with the same library into React Native
 * `Text` (`message-markdown.tsx` in `apps/mobile`). What decides the output
 * lives here, so the two can't drift: the element allowlist, the #2209 depth
 * cap, the #2664 parse budget, and the bare-URL links. Each is
 * dependency-free: the mdast they walk is written out, for the reason
 * `markdown-depth-cap.ts` gives.
 */

import { bareUrlEnd, bareUrls, isOpenableHref } from "./links";
import { opensTooManyContainers } from "./markdown-depth-cap";
import { exceedsParseBudget } from "./markdown-parse-budget";

export {
  MAX_MESSAGE_MARKDOWN_DEPTH,
  opensTooManyContainers,
  remarkDepthCap,
  type DepthCapOptions,
} from "./markdown-depth-cap";
export {
  EVENT_PARSE_BUDGET,
  exceedsParseBudget,
  IMAGE_PARSE_BUDGET,
  LABEL_PARSE_BUDGET,
} from "./markdown-parse-budget";

/**
 * Whether a body should skip remark's parse and render as its raw text,
 * decided from the source alone. Both renderers ask this before parsing and
 * pass the answer to `remarkDepthCap` as `flatten`, handing remark an empty
 * string instead of the body. It covers the two ways a body within the length
 * cap is too costly to parse: a line that opens too many containers (#2209,
 * `opensTooManyContainers`), and a paragraph whose emphasis, labels or images
 * would make micromark's inline resolvers quadratic (#2664,
 * `exceedsParseBudget`). Either one's body would take seconds on the main
 * thread, for every member who opens the channel.
 */
export function skipsMarkdownParse(content: string): boolean {
  return opensTooManyContainers(content) || exceedsParseBudget(content);
}

/**
 * `spec/behavior/chat/README.md`'s "Text formatting" set, and nothing wider:
 * bold, italic, inline code, code blocks, links, and the `br` a line break
 * becomes. Headings, lists, block quotes, images and tables aren't part of the
 * set, and a message that opens with `# ` shouldn't blow a chat row up into a
 * heading. A renderer passes this as react-markdown's `allowedElements` with
 * `unwrapDisallowed`, so a disallowed element's text still shows.
 */
export const MESSAGE_MARKDOWN_ELEMENTS: readonly string[] = [
  "p",
  "strong",
  "em",
  "code",
  "pre",
  "a",
  "br",
];

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

export interface BareUrlOptions {
  /** The raw message body, where a URL the parse split is measured whole. */
  content: string;
}

/** A link's label is already a link: a URL written inside it stays its text. */
const OPAQUE_TO_BARE_URLS = new Set(["link", "linkReference"]);

/** What a URL typed on its own can run through: prose, and emphasis inside it. */
const URL_CAN_SPAN = new Set(["text", "emphasis", "strong"]);

/**
 * A remark transform that links every bare `http://` or `https://` URL in the
 * body's text, by `bareUrls`' rule. CommonMark links only `<url>` and
 * `[text](url)`; a URL typed on its own needs GFM's autolink extension, which
 * neither client loads, so this is the one rule both would share.
 *
 * Code and links are never touched: `inlineCode` and `code` are leaves
 * carrying a `value`, not `text` children, and a link's label is skipped, so a
 * URL written in either stays as it is.
 *
 * **A URL is measured on the raw body.** The parser reads the body's emphasis
 * before this runs, so a URL holding a delimiter pair (`…/pkg/__init__.py`,
 * `?q=a*b*c`) arrives as a text node cut short at the emphasis. When a URL's
 * run reaches the end of its text node, it is measured again on the raw body,
 * through the prose and emphasis that follow (`measureInSource`), and becomes one
 * link that reads as typed; whatever of the sibling it ends inside is left as
 * typed too, as `bareUrls` would leave it in plain text. It stops before code,
 * a link or an image, which keep their own meaning, and before any text that
 * isn't its source verbatim (an entity, an escape), so an href is never built
 * from source the parser decoded. That needs the parser's source positions:
 * run this before `remark-breaks`, whose split text nodes carry none.
 *
 * Mobile runs it, since mobile has linked bare URLs since #2775. Web doesn't
 * yet (#2862). Run it after `remarkDepthCap`, which has to see the tree first;
 * the walk is an explicit stack for the same reason the cap's is. It is
 * linear: a raw measurement reads only the siblings it then covers, and the
 * one it stops at.
 */
export function remarkBareUrls(options: BareUrlOptions) {
  return (tree: MdastNode): void => {
    const stack: MdastNode[] = [tree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!Array.isArray(node.children) || OPAQUE_TO_BARE_URLS.has(node.type)) {
        continue;
      }
      const siblings = [...node.children];
      const children: MdastNode[] = [];
      for (let i = 0; i < siblings.length; i += 1) {
        const child = siblings[i]!;
        if (child.type !== "text" || typeof child.value !== "string") {
          children.push(child);
          stack.push(child);
          continue;
        }
        const { parts, covered, rest } = linkBareUrls(
          siblings,
          i,
          options.content,
        );
        for (const part of parts) children.push(part);
        i += covered;
        // What is left of the sibling a URL ended inside is scanned next: it
        // can hold a URL of its own.
        if (rest) siblings[i--] = rest;
      }
      node.children = children;
    }
  };
}

function offsetsOf(node: MdastNode): [number, number] | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return start === undefined || end === undefined ? null : [start, end];
}

/** How many of a text node's leading characters are its source verbatim. */
function verbatimLength(node: MdastNode, start: number, content: string): number {
  const value = node.value ?? "";
  let length = 0;
  while (length < value.length && content[start + length] === value[length]) {
    length += 1;
  }
  return length;
}

/**
 * Whether every character an emphasis draws is its source verbatim, and it
 * holds only prose and emphasis. A text child must match its whole source
 * span: one whose decoded value is only a prefix of it ends in an entity or an
 * escape (`a&amp;` reads `a&`).
 */
function verbatimInside(node: MdastNode, content: string): boolean {
  return (node.children ?? []).every((child) => {
    const at = offsetsOf(child);
    if (!at) return false;
    if (child.type === "text") {
      const length = (child.value ?? "").length;
      return (
        at[1] - at[0] === length &&
        verbatimLength(child, at[0], content) === length
      );
    }
    return URL_CAN_SPAN.has(child.type) && verbatimInside(child, content);
  });
}

/**
 * `siblings[index]`, a text node, as the text and link nodes it splits into;
 * how many siblings after it its last URL covered on the raw body; and what is
 * left of the sibling that URL ended inside.
 */
function linkBareUrls(
  siblings: MdastNode[],
  index: number,
  content: string,
): { parts: MdastNode[]; covered: number; rest: MdastNode | null } {
  const node = siblings[index]!;
  const value = node.value ?? "";
  const urls = bareUrls(value);
  // Untouched when there is nothing to link, so the node keeps its position.
  if (urls.length === 0) return { parts: [node], covered: 0, rest: null };

  const parts: MdastNode[] = [];
  let at = 0;
  let run: SourceRun | null = null;
  urls.forEach(({ start, end, href }, n) => {
    if (start > at) parts.push({ type: "text", value: value.slice(at, start) });
    run = n === urls.length - 1 ? measureInSource(siblings, index, start, end, content) : null;
    const label = run ? content.slice(run.start, run.end) : value.slice(start, end);
    parts.push({
      type: "link",
      url: run ? label : href,
      children: [{ type: "text", value: label }],
    });
    at = end;
  });
  const found = run as SourceRun | null;
  // A URL measured on the raw body ends past this node, so nothing of it is
  // left; otherwise the node's tail after its last URL stays text.
  if (!found && at < value.length) {
    parts.push({ type: "text", value: value.slice(at) });
  }
  return { parts, covered: found?.covered ?? 0, rest: found?.rest ?? null };
}

interface SourceRun {
  /** Where the raw URL starts and ends in the body. */
  start: number;
  end: number;
  /** Siblings after the text node the URL takes, the last maybe in part. */
  covered: number;
  /** The rest of the sibling the URL ends inside, as it was typed. */
  rest: MdastNode | null;
}

/**
 * The last URL of `siblings[index]`, `value.slice(start, end)`, measured on
 * the raw body when its run reaches the end of the node: through the prose and
 * emphasis after it that are their source verbatim, up to the first holding
 * whitespace or `<`, where a URL stops anyway. `null` when the URL doesn't run
 * on past its node, so the parse's own split stands.
 */
function measureInSource(
  siblings: MdastNode[],
  index: number,
  start: number,
  end: number,
  content: string,
): SourceRun | null {
  const node = siblings[index]!;
  const value = node.value ?? "";
  const at = offsetsOf(node);
  // The run must reach the node's end, and the node's text from the URL on must
  // be its source verbatim, which also places the URL in the body. Earlier
  // text may differ (an indent or a quote marker the parser dropped).
  const tail = value.slice(start);
  if (!at || /[\s<]/.test(value.slice(end))) return null;
  if (content.slice(at[1] - tail.length, at[1]) !== tail) return null;
  const urlStart = at[1] - tail.length;

  const span: Array<{ node: MdastNode; start: number; stop: number }> = [];
  let limit = at[1];
  for (let j = index + 1; j < siblings.length; j += 1) {
    const sibling = siblings[j]!;
    const where = offsetsOf(sibling);
    if (!where || where[0] !== limit || !URL_CAN_SPAN.has(sibling.type)) break;
    if (sibling.type === "text") {
      const same = verbatimLength(sibling, where[0], content);
      span.push({ node: sibling, start: where[0], stop: where[1] });
      limit = where[0] + same;
      if (same < (sibling.value ?? "").length || /[\s<]/.test(sibling.value ?? "")) {
        break;
      }
      continue;
    }
    // An emphasis the URL might end partway through would be left as typed,
    // dropping any formatting nested in its rest; a URL can't run past
    // whitespace or `<` anyway, so it ends before an emphasis holding either.
    if (
      !verbatimInside(sibling, content) ||
      /[\s<]/.test(content.slice(where[0], where[1]))
    ) {
      break;
    }
    span.push({ node: sibling, start: where[0], stop: where[1] });
    limit = where[1];
  }
  if (limit === at[1]) return null;

  const urlEnd = bareUrlEnd(content, urlStart, limit);
  if (urlEnd <= at[1] || !isOpenableHref(content.slice(urlStart, urlEnd))) {
    return null;
  }
  const inside = span.findIndex(({ stop }) => stop > urlEnd);
  if (inside === -1) {
    return { start: urlStart, end: urlEnd, covered: span.length, rest: null };
  }
  const { node: last, start: lastStart, stop } = span[inside]!;
  if (urlEnd <= lastStart) {
    return { start: urlStart, end: urlEnd, covered: inside, rest: null };
  }
  // The URL ends inside this sibling. What is left of it reads as typed: a
  // text node keeps its own value (verbatim up to here). An emphasis holds no
  // whitespace here, so the URL ends inside it only where `bareUrlEnd` gave
  // trailing punctuation back: its closing delimiters, shown as typed since
  // they no longer close anything.
  const restValue =
    last.type === "text"
      ? (last.value ?? "").slice(urlEnd - lastStart)
      : content.slice(urlEnd, stop);
  return {
    start: urlStart,
    end: urlEnd,
    covered: inside + 1,
    rest: {
      type: "text",
      value: restValue,
      position: { start: { offset: urlEnd }, end: { offset: stop } },
    },
  };
}
