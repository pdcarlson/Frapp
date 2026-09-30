/**
 * Chat's markdown, for both clients (#2861).
 *
 * Web renders a message body with react-markdown (`message-markdown.tsx` in
 * `apps/web`) and mobile renders it with the same library into React Native
 * `Text` (`message-markdown.tsx` in `apps/mobile`). What decides the output
 * lives here, so the two can't drift: the element allowlist, the #2209 depth
 * cap, and the bare-URL links. Each is dependency-free: the mdast they walk is
 * written out, for the reason `markdown-depth-cap.ts` gives.
 */

import { bareUrlEnd, bareUrls, isOpenableHref } from "./links";

export {
  MAX_MESSAGE_MARKDOWN_DEPTH,
  opensTooManyContainers,
  remarkDepthCap,
  type DepthCapOptions,
} from "./markdown-depth-cap";

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

/**
 * A remark transform that links every bare `http://` or `https://` URL in the
 * body's text, by `bareUrls`' rule. CommonMark links only `<url>` and
 * `[text](url)`; a URL typed on its own needs GFM's autolink extension, which
 * neither client loads, so this is the one rule both would share.
 *
 * Code is never touched: `inlineCode` and `code` are leaves carrying a
 * `value`, not `text` children, so a URL in code stays code.
 *
 * **A URL is measured on the raw body.** The parser has read the body's
 * emphasis before this runs, so a URL holding a delimiter pair
 * (`…/pkg/__init__.py`, `?q=a*b*c`) arrives as a text node cut short at the
 * emphasis, and linking that alone would open the wrong page. When a URL runs
 * to the end of its text node, it is measured again on the raw body, and the
 * siblings the raw URL covers become one link that reads as typed. That needs
 * the parser's source positions, so run this before `remark-breaks`, whose
 * split text nodes carry none. A text node that isn't its source slice
 * verbatim (an entity or an escape in it) is linked by its value alone.
 *
 * Mobile runs it, since mobile has linked bare URLs since #2775. Web doesn't
 * yet (#2862). Run it after `remarkDepthCap`, which has to see the tree first;
 * the walk is an explicit stack for the same reason the cap's is.
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
        // What is left of the last sibling a URL covered is scanned next: it
        // can hold a URL of its own.
        if (rest) siblings[i--] = rest;
      }
      node.children = children;
    }
  };
}

/** Where a text node sits in the raw body, when its value is that slice verbatim. */
function sourceSpan(node: MdastNode, content: string): [number, number] | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (start === undefined || end === undefined) return null;
  return content.slice(start, end) === node.value ? [start, end] : null;
}

/**
 * `siblings[index]`, a text node, as the text and link nodes it splits into;
 * how many siblings after it its last URL covered on the raw body; and what is
 * left of a text sibling that URL ends inside.
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
    let label = value.slice(start, end);
    const span =
      n === urls.length - 1 && end === value.length
        ? sourceSpan(node, content)
        : null;
    run = span
      ? runInSource(siblings, index, span[0] + start, span[1], content)
      : null;
    if (run) label = content.slice(span![0] + start, run.end);
    parts.push({
      type: "link",
      url: run ? label : href,
      children: [{ type: "text", value: label }],
    });
    at = end;
  });
  if (at < value.length) parts.push({ type: "text", value: value.slice(at) });
  const found = run as SourceRun | null;
  return { parts, covered: found?.covered ?? 0, rest: found?.rest ?? null };
}

interface SourceRun {
  /** Where the raw URL ends in the body. */
  end: number;
  /** Siblings after the text node that the URL takes, the last maybe in part. */
  covered: number;
  /** The rest of a text sibling the URL ends inside, as a text node of its own. */
  rest: MdastNode | null;
}

/**
 * The raw URL starting at `urlStart`, when it runs on past its text node,
 * which ends at `nodeEnd`. `null` when it stops there, or when it would end
 * inside a sibling that isn't a verbatim text node, which can't be split; the
 * link then stays what the text node held.
 */
function runInSource(
  siblings: MdastNode[],
  index: number,
  urlStart: number,
  nodeEnd: number,
  content: string,
): SourceRun | null {
  const end = bareUrlEnd(content, urlStart);
  if (end <= nodeEnd || !isOpenableHref(content.slice(urlStart, end))) {
    return null;
  }
  let reached = nodeEnd;
  let covered = 0;
  for (let j = index + 1; j < siblings.length && reached < end; j += 1) {
    const sibling = siblings[j]!;
    const start = sibling.position?.start?.offset;
    const stop = sibling.position?.end?.offset;
    if (start !== reached || stop === undefined) return null;
    covered += 1;
    if (stop <= end) {
      reached = stop;
      continue;
    }
    if (sibling.type !== "text" || !sourceSpan(sibling, content)) return null;
    return {
      end,
      covered,
      rest: {
        type: "text",
        value: content.slice(end, stop),
        position: { start: { offset: end }, end: { offset: stop } },
      },
    };
  }
  return reached === end ? { end, covered, rest: null } : null;
}
