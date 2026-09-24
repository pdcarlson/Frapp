/**
 * A remark transform that stops an over-nested message from crashing the
 * render (#2209).
 *
 * **The exposure.** Message bodies are length-capped, never depth-capped:
 * `CHAT_MESSAGE_CONTENT_MAX_LENGTH` is 10,000 characters. A body of
 * `"> ".repeat(4999) + "hi"` fits that cap and parses to about five thousand
 * nested blockquotes; nested lists and emphasis runs get there too. remark's
 * parse builds that tree without overflowing, but every pass after it recurses
 * once per level — `remark-breaks`' walk, `mdast-util-to-hast`, react-markdown's
 * own element filter and `hast-util-to-jsx-runtime` — and one of them throws
 * `RangeError: Maximum call stack size exceeded`. The throw happens during
 * render, and the nearest error boundary is `(dashboard)/error.tsx`, so one
 * message replaced the whole `/chat` content column, composer included, for
 * every member who opened that channel. The message is stored before anyone
 * renders it, so its author only had to send it once.
 *
 * **The behaviour.** When the parsed tree is deeper than
 * `MAX_MESSAGE_MARKDOWN_DEPTH`, the message renders as its raw text, exactly
 * as typed, in one paragraph: no formatting, and no nesting for a later pass
 * to recurse through. That is deliberate rather than a crash caught somewhere.
 * It is also the honest rendering: a body nested that deep carries no
 * formatting a reader could follow, and showing the source says what was sent.
 * Mention chips still paint, because `remarkMentionChips` tokenizes the raw
 * body and walks `text` nodes, and this leaves exactly one. That one node also
 * holds any code span or link label, so a handle written inside backticks is
 * chipped here although a normally rendered message leaves it plain. The chip
 * is still true: the API's tokenizer ignores markdown, so that member was
 * notified.
 *
 * **Parse time is a separate exposure.** remark's parse is super-linear on some
 * bodies. `opensTooManyContainers` below skips the parse for the worst of them,
 * lines of container markers. Emphasis runs and nested brackets or images still
 * take over a second at the length cap, once per mount; that is #2664.
 *
 * **Why the render path, not only send-time validation.** Messages already
 * stored have whatever depth they have, so a send-time rule alone would leave
 * them unrenderable forever. The cap has to sit where the tree is walked.
 *
 * **Why it must run first.** Only remark's parse precedes a remark plugin, and
 * the parse is the one stage that handles depth iteratively. Every plugin after
 * this one, and everything react-markdown runs after the plugins, sees a tree
 * at most the cap deep. The measurement below is an explicit-stack walk for the
 * same reason; `remark-mention-chips.ts` explains why neither file imports
 * `unist-util-visit` or `@types/mdast`.
 */

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/**
 * How deep a message's mdast may nest before it renders as raw text. The root
 * is depth 0, so ordinary chat formatting sits well inside: `**bold _italic_**`
 * in a list item in a blockquote is root → blockquote → list → listItem →
 * paragraph → strong → emphasis → text, depth 7. Measured in Node 24, the
 * passes after the parse survived 1,600 nested blockquotes and threw at 3,200.
 * A browser's stack is smaller and React's render adds frames of its own, so
 * the cap sits two orders of magnitude below that rather than near it.
 */
export const MAX_MESSAGE_MARKDOWN_DEPTH = 32;

/** Whether any node in `root` sits deeper than `limit`, without recursion. */
function exceedsDepth(root: MdastNode, limit: number): boolean {
  const stack: Array<{ node: MdastNode; depth: number }> = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > limit) return true;
    if (!Array.isArray(node.children)) continue;
    for (const child of node.children) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
  return false;
}

/**
 * Whether one line of `content` opens more containers than the depth cap
 * allows, read straight off the source without parsing it.
 *
 * The depth cap above stops the crash, but it runs after remark's parse, and
 * the parse is quadratic in the containers a single line opens. Measured in
 * Node 24 on a 10,000-character body, `"- ".repeat(4999) + "hi"` took 6.8 s to
 * parse and `"+ "` 1.4 s, against 75 ms for the same length of `"> "`. Every
 * member who opens the channel pays that on the main thread. So a line whose
 * leading run of block-quote and list markers is already longer than the cap
 * skips the parse and renders as raw text straight away: each marker opens at
 * least one mdast level, so the tree would have been over the cap anyway and
 * the outcome is the one `remarkDepthCap` would have reached. It covers
 * container markers only; see the header for what it leaves to #2664.
 *
 * It splits lines where CommonMark does, at `\n`, `\r` or both, and skips the
 * byte-order mark micromark drops from the start of a document. Missing either
 * would let a crafted body hide its marker line from the scan and still pay the
 * full parse.
 *
 * It counts `>`, `-`, `+`, `*` and `1.`/`1)` markers, each separated by
 * optional spaces or tabs, from the start of each line. A line made only of
 * `-` markers, or only of `*` markers, is exempt: CommonMark reads it as a
 * thematic break, one level deep, and it parses in linear time. Beyond that the
 * scan is deliberately loose. It also counts marker lines that CommonMark
 * reads as something shallower: a line indented four spaces, a line inside a
 * fenced code block, or a block quote around a thematic break. Such a message
 * renders as its raw text. Tracking fences here instead would open a hole,
 * because a fence opened inside a list item closes when the item does, and a
 * body could use that to hide a marker line from the scan. Over-counting costs
 * one message's formatting; under-counting costs every reader seconds.
 */
export function opensTooManyContainers(content: string): boolean {
  let count = 0;
  let inPrefix = true;
  // The one marker character a thematic break could be made of: null before
  // the line's first marker, false once the line can't be a thematic break.
  let thematic: string | null | false = null;
  for (let i = content.startsWith("\uFEFF") ? 1 : 0; i <= content.length; i += 1) {
    const char = content[i];
    if (char === undefined || char === "\n" || char === "\r") {
      if (count > MAX_MESSAGE_MARKDOWN_DEPTH && !(inPrefix && thematic)) return true;
      count = 0;
      inPrefix = true;
      thematic = null;
      continue;
    }
    if (!inPrefix || char === " " || char === "\t") continue;

    let markerEnd = -1;
    if (char === ">") {
      markerEnd = i + 1;
    } else if (char === "-" || char === "+" || char === "*") {
      markerEnd = i + 1;
      if (!isMarkerBoundary(content, markerEnd)) markerEnd = -1;
    } else if (isDigit(char)) {
      let end = i;
      while (end < content.length && end - i < 9 && isDigit(content[end])) end += 1;
      if ((content[end] === "." || content[end] === ")") && isMarkerBoundary(content, end + 1)) {
        markerEnd = end + 1;
      }
    }

    if (markerEnd === -1) {
      // Content follows the markers, so the line is not a thematic break.
      if (count > MAX_MESSAGE_MARKDOWN_DEPTH) return true;
      inPrefix = false;
      continue;
    }
    count += 1;
    thematic = (char === "-" || char === "*") && (thematic === null || thematic === char) ? char : false;
    i = markerEnd - 1;
  }
  return false;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

/** A list marker needs a space, a tab or the end of the line after it. */
function isMarkerBoundary(content: string, index: number): boolean {
  const next = content[index];
  return next === undefined || next === " " || next === "\t" || next === "\n" || next === "\r";
}

export interface DepthCapOptions {
  /** The raw message body, rendered verbatim when the tree is too deep. */
  content: string;
  /**
   * Render `content` as raw text without looking at the tree. Set when
   * `opensTooManyContainers` has already decided, and the renderer handed
   * remark an empty string rather than pay for the parse.
   */
  flatten?: boolean;
}

export function remarkDepthCap(options: DepthCapOptions) {
  return (tree: MdastNode): void => {
    if (!options.flatten && !exceedsDepth(tree, MAX_MESSAGE_MARKDOWN_DEPTH)) return;
    tree.children = [
      { type: "paragraph", children: [{ type: "text", value: options.content }] },
    ];
  };
}
