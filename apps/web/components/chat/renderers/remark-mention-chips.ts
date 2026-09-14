import { findMentionSpans } from "@repo/validation";
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
 * **The tokenizer is the server's.** `findMentionSpans` walks the same
 * `MENTION_TOKEN` pattern `resolveMentions` does (`packages/validation`), so
 * the run this paints is exactly the run the API considered at send time.
 * Re-deriving "what looks like a mention" here with a local regex is how a
 * bubble starts highlighting `@sam` in an email address nobody was notified
 * about, or leaving `@O'Brien` plain after notifying him.
 *
 * What this does **not** claim is that a chipped token *resolved*. Resolution
 * needs the chapter roster and happens server-side; a rendered message carries
 * only its text. So the chip marks "addressed someone by name", which is what a
 * reader is actually scanning for, and an unresolvable `@nobody` is chipped
 * too. Highlighting only resolved mentions would need the roster on every row
 * and would still be wrong the moment someone is renamed.
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

/** One `text` node split into the alternating plain / chipped runs it contains. */
function splitTextNode(value: string): MdastNode[] {
  const spans = findMentionSpans(value);
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
 * it would save is eight lines.
 */
function transform(node: MdastNode, opaque: boolean): void {
  if (!Array.isArray(node.children)) return;
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (!opaque && child.type === "text" && child.value !== undefined) {
      next.push(...splitTextNode(child.value));
      continue;
    }
    transform(child, opaque || OPAQUE_TO_MENTIONS.has(child.type));
    next.push(child);
  }
  node.children = next;
}

export function remarkMentionChips() {
  return (tree: MdastNode): void => transform(tree, false);
}
