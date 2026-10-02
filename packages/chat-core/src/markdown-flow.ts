/**
 * A message body's line structure, for both clients (#2861, #2934).
 *
 * remark and hast leave line breaks in two places a chat body doesn't want
 * them. `mdast-util-to-hast` writes a `"\n"` text node after every `br`, and
 * puts `"\n"` separators between block children. Drawn as written (a `Text` on
 * mobile, web's `pre-wrap` body), each `br` breaks its line twice, and a body
 * that opens with a list or a quote opens with an empty line.
 *
 * `layOutMessageBody` takes the hast react-markdown builds and writes each
 * break out once: it unwraps what the allowlist drops, removes the `"\n"`
 * after a `br`, and turns the top level into one line of flow with every
 * boundary as explicit `"\n"`s, counted from the source. A renderer that draws
 * the result inline (mobile's single `Text`, web's inline paragraphs under
 * `pre-wrap`) shows one line per break and one blank line per paragraph gap,
 * and the two clients agree by construction. It runs as each client's last
 * rehype pass.
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
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

/** The elements drawn as blocks. Everything else flows inline. */
const BLOCKS = new Set(["p", "pre"]);

/** The blocks the trailing markers go under rather than after (`components.md` §11). */
const OWN_LINE_AFTER = new Set(["pre", "ul", "ol", "blockquote"]);

/** Breaks between two blocks: one blank line, a paragraph gap, at most. */
const MAX_BREAKS = 2;

/** A line ending, as micromark reads one. */
const LINE_ENDING = /\r\n|\r|\n/g;

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
function applyMessageAllowlist(
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

/** Where a node starts or ends in the source, from it or its first or last descendant. */
function offsetOf(node: HastNode, edge: "start" | "end"): number | undefined {
  const own = node.position?.[edge]?.offset;
  if (own !== undefined) return own;
  const children = node.children ?? [];
  const next = edge === "start" ? children[0] : children[children.length - 1];
  return next ? offsetOf(next, edge) : undefined;
}

/**
 * The line endings typed between two nodes, or `undefined` when either has no
 * source position. Plugins that split a text node (`remark-breaks`, the
 * mention chips) leave the pieces without one.
 */
function typedBreaks(
  previous: HastNode,
  next: HastNode,
  source: string,
): number | undefined {
  const from = offsetOf(previous, "end");
  const to = offsetOf(next, "start");
  if (from === undefined || to === undefined || from > to) return undefined;
  return source.slice(from, to).match(LINE_ENDING)?.length ?? 0;
}

/**
 * The body's top level as one line of flow, with each boundary written out
 * as line breaks.
 *
 * The count comes from the source: the line endings typed between two drawn
 * nodes, capped at one blank line. hast can't say it, since it puts one
 * `"\n"` between any two blocks and wraps every list and quote in more, so
 * reading its separators drew `Items:` and a list on the next line with a
 * blank line between them, and a nested list's items double-spaced. A
 * paragraph always ends its line, and a code block is always set apart by a
 * blank line. Where a node has no position, the separators decide, as they
 * did before. Nothing is written before the first node or after the last, so
 * a body that opens with a list or a quote doesn't open with an empty line
 * (#2934).
 */
function layOutMessageFlow(nodes: HastNode[], source: string): HastNode[] {
  const out: HastNode[] = [];
  let separators = 0;
  let afterBlock = false;
  let previous: HastNode | undefined;
  for (const node of nodes) {
    if (isSeparator(node)) {
      separators += (node.value ?? "").length;
      continue;
    }
    if (drawsNothing(node)) continue;
    const block = node.type === "element" && BLOCKS.has(node.tagName ?? "");
    if (previous) {
      let breaks =
        typedBreaks(previous, node, source) ??
        separators + (afterBlock ? 1 : 0);
      if (block || afterBlock) breaks = Math.max(breaks, 1);
      if (isElement(node, "pre") || isElement(previous, "pre")) {
        breaks = MAX_BREAKS;
      }
      breaks = Math.min(breaks, MAX_BREAKS);
      if (breaks > 0) out.push({ type: "text", value: "\n".repeat(breaks) });
    }
    out.push(node);
    previous = node;
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
 * Asked of the top level before the allowlist unwraps the blocks it is about.
 * The last block that draws anything decides, so a divider after a list
 * doesn't count.
 */
function endsInOwnLineBlock(nodes: HastNode[]): boolean {
  const last = nodes
    .filter((node) => !isSeparator(node) && !drawsNothing(node))
    .pop();
  return last?.type === "element" && OWN_LINE_AFTER.has(last.tagName ?? "");
}

export interface MessageBodyLayout {
  /** The new top level, to replace the root's children. */
  children: HastNode[];
  /** The trailing markers take a line of their own (`endsInOwnLineBlock`). */
  endsOnOwnLine: boolean;
}

/**
 * The whole pass, in the order it has to run: the closing block is read
 * before the allowlist unwraps it, then the allowlist, then the layout.
 *
 * `allowed` is the renderer's `allowedElements`. `source` is the string remark
 * parsed (the body, or `""` when `skipsMarkdownParse` flattened it), which the
 * positions index into.
 */
export function layOutMessageBody(
  nodes: HastNode[],
  { allowed, source }: { allowed: ReadonlySet<string>; source: string },
): MessageBodyLayout {
  const endsOnOwnLine = endsInOwnLineBlock(nodes);
  return {
    children: layOutMessageFlow(applyMessageAllowlist(nodes, allowed), source),
    endsOnOwnLine,
  };
}
