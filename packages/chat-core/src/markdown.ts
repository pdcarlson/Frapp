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

import { bareUrls } from "./links";

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
 * Mobile runs it, since mobile has linked bare URLs since #2775. Web doesn't
 * yet (#2862). Run it after `remarkDepthCap`, which has to see the tree
 * first. The walk is an explicit stack for the same reason the cap's is.
 */
export function remarkBareUrls() {
  return (tree: MdastNode): void => {
    const stack: MdastNode[] = [tree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!Array.isArray(node.children) || OPAQUE_TO_BARE_URLS.has(node.type)) {
        continue;
      }
      const children: MdastNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && typeof child.value === "string") {
          for (const part of linkBareUrls(child)) children.push(part);
        } else {
          children.push(child);
          stack.push(child);
        }
      }
      node.children = children;
    }
  };
}

/** One `text` node as the text and link nodes it splits into. */
function linkBareUrls(node: MdastNode): MdastNode[] {
  const value = node.value ?? "";
  const urls = bareUrls(value);
  // Untouched when there is nothing to link, so the node keeps its position.
  if (urls.length === 0) return [node];
  const parts: MdastNode[] = [];
  let at = 0;
  for (const { start, end, href } of urls) {
    if (start > at) parts.push({ type: "text", value: value.slice(at, start) });
    parts.push({
      type: "link",
      url: href,
      children: [{ type: "text", value: value.slice(start, end) }],
    });
    at = end;
  }
  if (at < value.length) parts.push({ type: "text", value: value.slice(at) });
  return parts;
}
