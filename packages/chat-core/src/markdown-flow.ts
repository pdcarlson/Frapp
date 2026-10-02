/**
 * A message body's line structure, for both clients (#2861, #2934).
 *
 * remark and hast leave line breaks in two places a chat body doesn't want
 * them. `mdast-util-to-hast` writes a `"\n"` text node after every `br`, and
 * puts `"\n"` separators between block children. Drawn as written (a `Text` on
 * mobile, web's `pre-wrap` body), each `br` breaks its line twice, and a body
 * that opens with a list or a quote opens with an empty line.
 *
 * These passes take the hast react-markdown builds and write each break out
 * once: `applyMessageAllowlist` unwraps what the allowlist drops and removes
 * the `"\n"` after a `br`, then `layOutMessageFlow` turns the top level into
 * one line of flow with every block boundary as explicit `"\n"`s. A renderer
 * that draws the result inline (mobile's single `Text`, web's inline
 * paragraphs under `pre-wrap`) shows one line per break and one blank line
 * per paragraph gap, and the two clients agree by construction.
 *
 * The hast slice is written out rather than imported: `hast` reaches the
 * clients only through react-markdown, for the reason `markdown-depth-cap.ts`
 * gives about mdast.
 */

export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** The elements drawn as blocks. Everything else flows inline. */
const BLOCKS = new Set(["p", "pre"]);

/** The blocks the trailing markers go under rather than after (`components.md` §11). */
const OWN_LINE_AFTER = new Set(["pre", "ul", "ol", "blockquote"]);

/** Breaks between two blocks: one blank line, a paragraph gap, at most. */
const MAX_BREAKS = 2;

export function isElement(node: HastNode | undefined, tagName: string): boolean {
  return node?.type === "element" && node.tagName === tagName;
}

/** The characters a node draws, a line break included. */
export function textOf(node: HastNode): string {
  // Raw HTML draws as the characters typed (`applyMessageAllowlist`).
  if (node.type === "text" || node.type === "raw") return node.value ?? "";
  if (isElement(node, "br")) return "\n";
  return (node.children ?? []).map(textOf).join("");
}

/** A text node holding only the line breaks hast puts between blocks. */
function isSeparator(node: HastNode): boolean {
  return node.type === "text" && /^\n+$/.test(node.value ?? "");
}

/**
 * An element that draws nothing once the allowlist has had it: a divider, or
 * the paragraph left around an image. The layout skips it, so it adds no
 * blank line, and the trailing markers look past it.
 */
function drawsNothing(node: HastNode): boolean {
  return (
    node.type === "element" &&
    node.tagName !== "br" &&
    textOf(node).trim() === ""
  );
}

/**
 * The allowlist, applied as react-markdown's own pass applies it
 * (`allowedElements` with `unwrapDisallowed`, raw HTML as its text), but in a
 * rehype pass, so the layout sees the tree that will render. react-markdown
 * applies both again afterwards and finds nothing left to do.
 *
 * It also drops the `"\n"` that hast puts after every `br`. Kept, that
 * newline breaks the line a second time (#2934).
 *
 * Recursive, which is safe because `remarkDepthCap` already ran: the tree is at
 * most `MAX_MESSAGE_MARKDOWN_DEPTH` deep.
 */
export function applyMessageAllowlist(
  nodes: HastNode[],
  allowed: ReadonlySet<string>,
): HastNode[] {
  const out: HastNode[] = [];
  for (const node of nodes) {
    if (node.type === "raw") {
      out.push({ type: "text", value: node.value ?? "" });
    } else if (node.type === "element") {
      const children = applyMessageAllowlist(node.children ?? [], allowed);
      if (allowed.has(node.tagName ?? "")) out.push({ ...node, children });
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
 * out as line breaks.
 *
 * A block ends its line, and each separator hast put after it adds one more.
 * So two paragraphs get a blank line between them, a list's items one line
 * each, and a paragraph that follows a heading starts on the next line. That
 * count is capped at one blank line. Separators at the start or end of the
 * body are dropped, so a body that opens with a list or a quote doesn't open
 * with an empty line (#2934).
 */
export function layOutMessageFlow(nodes: HastNode[]): HastNode[] {
  const out: HastNode[] = [];
  let separators = 0;
  let afterBlock = false;
  for (const node of nodes) {
    if (isSeparator(node)) {
      separators += (node.value ?? "").length;
      continue;
    }
    if (drawsNothing(node)) continue;
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

/**
 * Whether the body ends in a block that keeps lines of its own (a code block,
 * a list, a quote), so the trailing markers take a line of their own under it
 * rather than breaking it (`components.md` §11 § What rides the row). A
 * heading or raw HTML reads as a line of text, and the markers trail it.
 *
 * Asked of the top level before `applyMessageAllowlist` unwraps the blocks it
 * is about. The last block that draws anything decides, so a divider after a
 * list doesn't count.
 */
export function endsInOwnLineBlock(nodes: HastNode[]): boolean {
  const last = nodes
    .filter((node) => !isSeparator(node) && !drawsNothing(node))
    .pop();
  return last?.type === "element" && OWN_LINE_AFTER.has(last.tagName ?? "");
}
