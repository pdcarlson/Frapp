import { extractMentionTokens, findMentionSpans } from "@repo/validation";
import { MENTION_CHIP } from "../chip";

/**
 * A remark transform that lifts every `@`-token in a message body out of its
 * surrounding text and into its own node, so `MessageMarkdown` can paint it as
 * the §11 mention chip.
 *
 * **Why a remark plugin and not a pass over the rendered React tree.** The
 * alternative — recursing through `react-markdown`'s children and splitting the
 * strings it hands back — has to clone arbitrary elements to reach the text
 * inside `**bold**` or `*italic*`, and it cannot tell a text run that came from
 * a code span from one that came from prose without inspecting element types.
 * At the mdast layer both fall out for free: `inlineCode` and `code` are leaf
 * nodes carrying a `value` rather than `text` children, so a walk that only
 * touches `text` never sees them, and `@channel` inside backticks stays
 * literal — which is the difference between documenting a mention and making
 * one.
 *
 * **The tokenizer is the server's, and it is run over the server's string.**
 * Both halves matter, and the second one is not obvious. `findMentionSpans`
 * walks the same `MENTION_TOKEN` pattern `resolveMentions` does
 * (`packages/validation`) — but a remark plugin sees mdast `text` values, which
 * are what CommonMark *decoded*, while the API tokenizes the raw `content`
 * column. Those are different strings, and a message can exploit the gap:
 * `&#64;PresidentJane` carries no literal `@`, so the API resolves nobody and
 * notifies nobody, while remark hands this plugin a decoded `@PresidentJane`
 * that tokenizes perfectly. Chipping it would put a "she was addressed" mark on
 * a message that addressed her to no one — forgeable by any member, in a UI
 * whose whole job here is to say who got pinged.
 *
 * So the raw body is passed in, tokenized once, and a span is painted only if
 * the handle it spells is one the API's own pass found there. The decoded text
 * still decides *where* the chip goes — it has to, that is what is on screen —
 * but never *whether* there is one.
 *
 * The gap's other direction is left alone deliberately, because the defect is
 * not on this side: `ping\@alice` escapes the `@` for CommonMark, so the reader
 * sees `ping@alice` and this plugin correctly paints nothing — but the API
 * tokenizes the raw string, where `\@` is just an `@`, and notifies Alice
 * anyway. That is the API over-notifying on an escape, not the chip
 * under-painting, and it is filed rather than papered over here.
 *
 * What this does **not** claim is that a chipped token *resolved* to a member.
 * Resolution needs the chapter roster and happens server-side; a rendered
 * message carries only its text. So the chip marks "addressed someone by name",
 * which is what a reader is actually scanning for, and an unresolvable
 * `@nobody` is chipped too. Highlighting only resolved mentions would need the
 * roster on every row and would still be wrong the moment someone is renamed.
 */

/**
 * The slice of mdast this transform needs, written out rather than imported.
 * See the note on the walk below for why `@types/mdast` is not a dependency
 * this file may take.
 */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/** `@` is inert inside a link label — the text there is the link's, not prose. */
const OPAQUE_TO_MENTIONS = new Set(["link", "linkReference", "definition"]);

/**
 * The mdast node the split emits.
 *
 * `data.hName` is `mdast-util-to-hast`'s documented escape hatch for a node
 * type it has no handler for: the unknown-node fallback builds an element from
 * the node's *children*, and `hName`/`hProperties` then rename it and set its
 * attributes. The text therefore lives in a child `text` node rather than in a
 * `value` on this node — with a `value` and no children the fallback would
 * produce an empty element and the handle would vanish from the message.
 *
 * The chip's paint rides `hProperties` rather than a `components.mark` override
 * in `MessageMarkdown`, so the element arrives fully formed and the renderer
 * keeps one fewer override to get right. The recipe itself still lives in
 * `chip.ts` with the rest of chat's chrome; only the reference is here.
 *
 * `data-mention` carries the *token* the tokenizer read, which is not always
 * what the reader sees: `@jane.` leaves the stop outside the chip. Kept as an
 * attribute so the DOM says which member a chip claims to name, rather than
 * leaving that to be re-parsed off the label.
 */
interface MentionChipNode extends MdastNode {
  type: "mentionChip";
  children: [{ type: "text"; value: string }];
  data: {
    hName: "mark";
    hProperties: { className: string; "data-mention": string };
  };
}

function mentionChip(raw: string, token: string): MentionChipNode {
  return {
    type: "mentionChip",
    children: [{ type: "text", value: raw }],
    data: {
      hName: "mark",
      hProperties: { className: MENTION_CHIP, "data-mention": token },
    },
  };
}

/**
 * One `text` node split into the alternating plain / chipped runs it contains.
 *
 * `addressed` holds the handles the API's own pass found in the raw body,
 * folded to lower case because `MENTION_TOKEN` preserves the author's casing
 * and `@alice` and `@Alice` are one handle. A span the set does not contain is
 * left as plain text — see the header on why that check cannot be skipped.
 */
function splitTextNode(value: string, addressed: ReadonlySet<string>): MdastNode[] {
  const spans = findMentionSpans(value).filter((span) =>
    addressed.has(span.token.toLowerCase()),
  );
  if (spans.length === 0) return [{ type: "text", value }];

  const parts: MdastNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      parts.push({ type: "text", value: value.slice(cursor, span.start) });
    }
    parts.push(mentionChip(value.slice(span.start, span.end), span.token));
    cursor = span.end;
  }
  if (cursor < value.length) {
    parts.push({ type: "text", value: value.slice(cursor) });
  }
  return parts;
}

/**
 * Hand-rolled rather than `unist-util-visit`, which is in the tree only as a
 * transitive dependency of remark. Importing it — or `@types/mdast`, hoisted
 * the same way, which is why the node types above are structural — would make
 * this file depend on a package `apps/web` never declared: the kind that keeps
 * working until an unrelated dependency bump hoists it somewhere else. The walk
 * it would save is a dozen lines.
 *
 * **Iterative, with an explicit stack, rather than recursive.** mdast nesting
 * is attacker-controlled: a 10,000-character body of `"> "` — inside the
 * `CHAT_MESSAGE_CONTENT_MAX_LENGTH` cap — parses to some five thousand nested
 * blockquotes. A recursive walk is one more deep call chain over that tree. It
 * is *not* the one that breaks first: remark's own parse and
 * `mdast-util-to-hast`'s walk already throw `RangeError: Maximum call stack
 * size exceeded` on such a body with this plugin removed entirely, so the
 * crash is older than this file and is filed separately. This costs nothing,
 * and there is no reason to add a second way to hit it.
 */
function transform(root: MdastNode, addressed: ReadonlySet<string>): void {
  const stack: Array<{ node: MdastNode; opaque: boolean }> = [
    { node: root, opaque: false },
  ];
  while (stack.length > 0) {
    const { node, opaque } = stack.pop()!;
    if (!Array.isArray(node.children)) continue;
    const next: MdastNode[] = [];
    for (const child of node.children) {
      if (!opaque && child.type === "text" && child.value !== undefined) {
        next.push(...splitTextNode(child.value, addressed));
        continue;
      }
      stack.push({
        node: child,
        opaque: opaque || OPAQUE_TO_MENTIONS.has(child.type),
      });
      next.push(child);
    }
    node.children = next;
  }
}

export interface MentionChipOptions {
  /**
   * The **raw** message body — `message.content` as stored, before CommonMark
   * has decoded anything. This is the string the API tokenized, and the only
   * one that can say whether a handle was really addressed; see the header.
   */
  content: string;
}

export function remarkMentionChips(options: MentionChipOptions) {
  // Folded once per message rather than per text node: a body is one string and
  // a bubble can hold many nodes.
  const addressed = new Set(
    extractMentionTokens(options.content).map((token) => token.toLowerCase()),
  );
  return (tree: MdastNode): void => {
    // Nothing was addressed, so nothing can be chipped and the tree does not
    // need walking — the overwhelmingly common case for a chat message.
    if (addressed.size === 0) return;
    transform(tree, addressed);
  };
}
