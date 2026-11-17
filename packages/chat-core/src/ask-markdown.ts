import {
  askAnswerSegments,
  askEntityParts,
  type AskAnswer,
  type AskEntity,
} from "@repo/validation";
import { MESSAGE_RENDER_ELEMENTS } from "./markdown";

/**
 * Ask Frapp's answer drawn as markdown, on the phone and on web (#5429; Paul,
 * 2026-11-17: "We should process the raw markdown? Packages exist for this.").
 *
 * An answer goes through chat's own pipeline (`parseMessageMarkdown` on the
 * phone, `MessageMarkdown` on web: react-markdown, `remark-breaks`, the depth
 * cap and the line layout), so bold, italic and code look as they do in a
 * message. Three things are Ask's own, and live here so both clients draw them
 * the same way:
 *
 * - **Citation markers.** The server places each one at a character offset
 *   in the answer's raw text (`askAnswerSegments`). The source is parsed as
 *   the server wrote it, and `remarkAskAnswer` puts each marker in the text
 *   node whose source position holds that offset, as a `sup` the client
 *   draws as its gold marker. A marker that falls among delimiters (just
 *   after a closing `**`) goes at the end of the text before it. The pass
 *   runs before `remark-breaks`, which leaves the nodes it splits without
 *   positions. Putting a token into the source instead was tried first: a
 *   token just after a closing `**` kept the bold from closing.
 * - **People and channels.** The names the server listed (`askEntityParts`)
 *   become a `span` the client draws as chat draws a mention, in the same
 *   pass, which never looks inside code or a link's label.
 * - **Lists.** Chat's set has no lists: a message that starts with `- ` stays
 *   a line of text. An answer that lists things should read as a list, so
 *   `remarkAskLists` turns each list into lines led by a bullet or its
 *   number, one line an item, which the layout draws like any other lines.
 *
 * Headings stay out of the set, as in chat: the prompts ask for none, and one
 * that slips through reads as a line of text.
 */

/** A marker: where the server put it, and the citation it stands for. */
export interface AskMarker {
  /** Offset into the answer's raw text. */
  at: number;
  /** Index into the answer's sources: its number is this plus one. */
  source: number;
  /** Its place in `answer.citations`. */
  index: number;
}

/**
 * The answer's markers in reading order, cut as `askAnswerSegments` cuts them:
 * two of one source at one place are one marker.
 */
export function askMarkers(
  answer: Pick<AskAnswer, "text" | "citations">,
): AskMarker[] {
  const markers: AskMarker[] = [];
  let at = 0;
  for (const segment of askAnswerSegments(answer)) {
    if (segment.type === "text") {
      at += segment.text.length;
      continue;
    }
    markers.push({
      at,
      source: segment.citation.source,
      index: segment.index,
    });
  }
  return markers;
}

/** The slice of mdast the passes here touch, as `markdown-mentions.ts` writes it. */
interface MdastNode {
  type: string;
  value?: string;
  ordered?: boolean | null;
  start?: number | null;
  children?: MdastNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
  data?: Record<string, unknown>;
}

/** The elements an answer renders: chat's set, plus Ask's marker and name. */
export const ASK_RENDER_ELEMENTS: readonly string[] = [
  ...MESSAGE_RENDER_ELEMENTS,
  "sup",
  "span",
];

/** A marker element: `data-ask-marker` is its index in `askMarkers`. */
function markerNode(marker: number): MdastNode {
  return {
    type: "askMarker",
    children: [{ type: "text", value: String(marker + 1) }],
    data: {
      hName: "sup",
      hProperties: { "data-ask-marker": String(marker) },
    },
  };
}

function entityNode(part: {
  type: "member" | "channel";
  id: string;
  text: string;
}): MdastNode {
  return {
    type: "askEntity",
    children: [{ type: "text", value: part.text }],
    data: {
      hName: "span",
      hProperties: { "data-ask-entity": part.type, "data-ask-id": part.id },
    },
  };
}

/** A text node the walk found, with the parent it sits in. */
interface Found {
  node: MdastNode;
  parent: MdastNode;
  /** Inside a link's label: its words are the link's. */
  opaque: boolean;
}

/** Not prose: a link's label is the link's. Code has no text nodes at all. */
const OPAQUE = new Set(["link", "linkReference", "definition"]);

function startOf(node: MdastNode): number {
  return node.position?.start?.offset ?? 0;
}
function endOf(node: MdastNode): number {
  return node.position?.end?.offset ?? startOf(node);
}

/**
 * Every text node, in reading order. Iterative, as `remarkMentionChips`
 * walks, and run after `remarkDepthCap`.
 */
function textNodes(root: MdastNode): Found[] {
  const found: Found[] = [];
  const stack: Array<{ node: MdastNode; opaque: boolean }> = [
    { node: root, opaque: false },
  ];
  while (stack.length > 0) {
    const { node, opaque } = stack.pop()!;
    for (const child of node.children ?? []) {
      if (child.type === "text") {
        found.push({ node: child, parent: node, opaque });
      } else {
        stack.push({ node: child, opaque: opaque || OPAQUE.has(child.type) });
      }
    }
  }
  return found.sort((a, b) => startOf(a.node) - startOf(b.node));
}

/**
 * Where in a text node's value a marker at source offset `at` goes. The
 * value is its source slice unless an escape or an entity was decoded; then
 * the marker goes at the node's start or end, whichever it is past.
 */
function indexIn(node: MdastNode, at: number): number {
  const value = node.value ?? "";
  const start = startOf(node);
  if (value.length === endOf(node) - start) {
    return Math.min(Math.max(at - start, 0), value.length);
  }
  return at <= start ? 0 : value.length;
}

/**
 * Each marker's text node and place in it: the node whose last character is
 * just before its offset, or the last text before it when the offset falls
 * among delimiters. One placed before any text goes at the first.
 */
function placeMarkers(
  found: readonly Found[],
  markers: readonly AskMarker[],
): Map<MdastNode, Array<{ index: number; marker: number }>> {
  const placed = new Map<MdastNode, Array<{ index: number; marker: number }>>();
  markers.forEach((marker, number) => {
    const target =
      found.find(
        ({ node }) => startOf(node) < marker.at && marker.at <= endOf(node),
      ) ??
      [...found].reverse().find(({ node }) => endOf(node) <= marker.at) ??
      found[0];
    if (!target) return;
    const list = placed.get(target.node) ?? [];
    list.push({ index: indexIn(target.node, marker.at), marker: number });
    placed.set(target.node, list);
  });
  return placed;
}

function splitWords(
  value: string,
  entities: readonly AskEntity[],
  opaque: boolean,
): MdastNode[] {
  if (!value) return [];
  if (opaque) return [{ type: "text", value }];
  return askEntityParts(value, entities).map((part) =>
    part.type === "text"
      ? { type: "text", value: part.text }
      : entityNode(part),
  );
}

/**
 * Ask's pass over the answer's mdast: its markers and the names the server
 * listed (see the header). Run right after `remarkDepthCap`, while every text
 * node still has its position.
 */
export function remarkAskAnswer({
  entities,
  markers,
}: {
  entities: readonly AskEntity[];
  /** From `askMarkers`; a marker element's `data-ask-marker` indexes it. */
  markers: readonly AskMarker[];
}) {
  return (root: MdastNode): void => {
    const found = textNodes(root);
    const placed = placeMarkers(found, markers);
    for (const { node, parent, opaque } of found) {
      const value = node.value ?? "";
      const cuts = (placed.get(node) ?? []).sort((a, b) => a.index - b.index);
      const parts: MdastNode[] = [];
      let cursor = 0;
      for (const cut of cuts) {
        parts.push(
          ...splitWords(value.slice(cursor, cut.index), entities, opaque),
        );
        parts.push(markerNode(cut.marker));
        cursor = cut.index;
      }
      parts.push(...splitWords(value.slice(cursor), entities, opaque));
      // The line layout reads where the first piece starts.
      if (parts[0]?.type === "text") parts[0].position = node.position;
      const siblings = parent.children ?? [];
      siblings.splice(siblings.indexOf(node), 1, ...parts);
    }
  };
}

/** How far a nested list's lines sit in: two no-break spaces a level. */
const INDENT = "  ";

/**
 * One list as the inline content of a single paragraph: each item a line led
 * by "• " or its number, a nested list's items indented under it, and an
 * item's second paragraph on a line of its own.
 */
function listLines(list: MdastNode, depth: number): MdastNode[] {
  const out: MdastNode[] = [];
  const first = list.start ?? 1;
  (list.children ?? []).forEach((item, position) => {
    if (out.length > 0) out.push({ type: "break" });
    const lead = list.ordered ? `${first + position}. ` : "• ";
    out.push({ type: "text", value: INDENT.repeat(depth) + lead });
    let started = false;
    for (const block of item.children ?? []) {
      if (block.type === "list") {
        out.push({ type: "break" }, ...listLines(block, depth + 1));
        started = true;
        continue;
      }
      if (started) out.push({ type: "break" });
      // A paragraph's inline content, or a block's own children otherwise.
      out.push(...(block.children ?? []));
      started = true;
    }
  });
  return out;
}

/**
 * Turns every list into one paragraph of lines (see the header). Run after
 * `remarkAskAnswer`, whose markers it carries along, and after
 * `remarkDepthCap`, so the recursion is shallow.
 */
export function remarkAskLists() {
  const visit = (node: MdastNode): void => {
    if (!Array.isArray(node.children)) return;
    node.children = node.children.map((child) => {
      if (child.type === "list") {
        return {
          type: "paragraph",
          position: child.position,
          children: listLines(child, 0),
        };
      }
      visit(child);
      return child;
    });
  };
  return visit;
}

/**
 * A streaming answer's preview as markdown that never shows a half-written
 * delimiter: an unclosed `**`, `__` or backtick at the end is left out until
 * the chunk that closes it arrives (#5429).
 */
export function askPreviewMarkdown(preview: string): string {
  let text = preview;
  for (const delimiter of ["**", "__", "`"]) {
    const count = text.split(delimiter).length - 1;
    if (count % 2 === 1) {
      const at = text.lastIndexOf(delimiter);
      text = text.slice(0, at) + text.slice(at + delimiter.length);
    }
  }
  return text;
}

/**
 * The answer's words to copy: what the reader sees, without the markdown's
 * delimiters. Lists keep their lines; bold, italic and code keep their words.
 */
export function askPlainWords(text: string): string {
  return text
    .replace(/(\*\*|__)(.+?)\1/gs, "$2")
    .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ");
}
