import { clampBox, type Box, type BoxesByPage } from "./geometry";
import type { PlacedText } from "./text-layer";

/**
 * Suggested redaction boxes for backwork bulk upload (#5245).
 *
 * When a document opens in the editor, its own text layer is searched for what
 * a box is usually drawn over, and boxes go there before the person looks:
 *
 * - the space after a "Name:", "Student ID:", "NetID:" or "Signature:" label,
 *   where a typed or handwritten name sits (a printed exam that a student filled
 *   in by hand has the label as text and the name as ink, so the box covers the
 *   area, not a word);
 * - an email address;
 * - a long run of digits, the shape of a student ID;
 * - the full name of anyone in the chapter, "First Last" or "Last, First".
 *
 * This runs on the device and is plain matching: no model reads the original
 * file (Paul, 2026-11-16: the upload AI sees only redacted pages). The person
 * still checks every page, moves or deletes a box, and draws what this missed,
 * above all a name written somewhere with no label, and any scanned page,
 * which has no text to search.
 */

/** A chapter member's name, as the roster spells it. */
export type RosterName = string;

export type SuggestPage = {
  /** Page size at scale 1, the boxes' coordinate space. */
  width: number;
  height: number;
  items: readonly PlacedText[];
};

/** How far left and right of a match a box reaches, as a share of font size. */
const PAD = 0.25;
/** Space after a label, in page units, when nothing on the line ends it first. */
const LABEL_FIELD_WIDTH = 240;
/** Handwriting rises above the printed line, so a label's box does too. */
const FIELD_ABOVE = 1.45;
const FIELD_BELOW = 0.5;
/** The least a field reaches above its line, however tight the lines. */
const MIN_FIELD_ABOVE = 0.6;
/** A printed glyph's reach below and above its baseline (`text-layer.ts`). */
const DESCENT = 0.3;
const ASCENT = 1.05;
/** Space between a label and its box, past the text layer's 2-point margin. */
const LABEL_GAP = 3;
/** Page margin a label's box stops at. */
const PAGE_MARGIN = 18;

/**
 * A label whose blank holds a person's identity. Matched only when followed by
 * a colon, a "#", or a run of underscores, so "Name the enzyme..." in a
 * question never matches.
 */
const LABEL =
  /\b(?:(?:student|full|print(?:ed)?|your|last|first)\s+)?(?:name|id(?:\s*(?:no\.?|number|num\.?))?|net\s*id|e-?mail|signature|sid|uin|pid|rin|banner\s*id|pennkey|onyen|eid|uni)(?:\s*\([^)\n]{0,30}\))?\s*(?:[:#]|(?=_{3,}))/gi;

/** What ends a label's field: the next "Word:" on the line (another field, such as "Section:" or "Date:"). */
const FIELD_END = /[\p{L}#.]+\s*:/gu;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Seven to ten digits, optionally after one letter: most school ID shapes. */
const ID_NUMBER = /\b[A-Za-z]?\d{7,10}\b/g;

type Line = {
  text: string;
  /** For each character of `text`, the item it came from and its index there; -1 for an added space. */
  map: Array<{ item: number; index: number } | null>;
  items: number[];
  baseline: number;
  size: number;
};

/** Upright items grouped into lines by baseline, left to right; every other item is a line of its own. */
function buildLines(items: readonly PlacedText[]): Line[] {
  const lines: Line[] = [];
  const upright: number[] = [];
  items.forEach((item, index) => {
    if (item.upright) {
      upright.push(index);
      return;
    }
    const line: Line = {
      text: "",
      map: [],
      items: [],
      baseline: item.rect.y + item.rect.height,
      size: item.rect.height,
    };
    appendItem(line, item, index);
    lines.push(line);
  });

  upright.sort((a, b) => items[a]!.upright!.baseline - items[b]!.upright!.baseline);
  const groups: number[][] = [];
  for (const index of upright) {
    const { baseline, size } = items[index]!.upright!;
    const group = groups.at(-1);
    const head = group ? items[group[0]!]!.upright! : null;
    if (group && head && Math.abs(head.baseline - baseline) <= Math.min(head.size, size) * 0.4) {
      group.push(index);
    } else {
      groups.push([index]);
    }
  }
  for (const group of groups) {
    group.sort((a, b) => items[a]!.upright!.x - items[b]!.upright!.x);
    const head = items[group[0]!]!.upright!;
    const line: Line = { text: "", map: [], items: [], baseline: head.baseline, size: head.size };
    group.forEach((index, n) => {
      if (n > 0) {
        line.text += " ";
        line.map.push(null);
      }
      appendItem(line, items[index]!, index);
    });
    lines.push(line);
  }
  return lines;
}

function appendItem(line: Line, item: PlacedText, index: number) {
  const chars = Array.from(item.str);
  chars.forEach((char, at) => {
    // One character for one, so the map stays aligned.
    line.text += char.replace(APOSTROPHES, "'");
    line.map.push({ item: index, index: at });
  });
  line.items.push(index);
}

/** The part of one item that characters `from` to `to` (exclusive) of a line cover. */
function spanBoxes(
  line: Line,
  from: number,
  to: number,
  items: readonly PlacedText[],
): Box[] {
  const byItem = new Map<number, { first: number; last: number }>();
  for (let at = from; at < to; at += 1) {
    const ref = line.map[at];
    if (!ref) continue;
    const seen = byItem.get(ref.item);
    if (seen) seen.last = ref.index;
    else byItem.set(ref.item, { first: ref.index, last: ref.index });
  }
  const boxes: Box[] = [];
  for (const [index, { first, last }] of byItem) {
    const item = items[index]!;
    const length = Array.from(item.str).length;
    if (!item.upright || length === 0) {
      boxes.push(item.rect);
      continue;
    }
    const cell = item.rect.width / length;
    const pad = item.upright.size * PAD;
    boxes.push({
      x: item.rect.x + first * cell - pad,
      y: item.rect.y,
      width: (last - first + 1) * cell + pad * 2,
      height: item.rect.height,
    });
  }
  return boxes;
}

/** The last character from an item before position `end` of a line. */
function lastRef(line: Line, end: number): { item: number; index: number } | null {
  for (let at = end - 1; at >= 0; at -= 1) {
    const ref = line.map[at];
    if (ref) return ref;
  }
  return null;
}

/** Where on the page the character at `at` of an upright line starts, in page units. */
function charX(line: Line, at: number, items: readonly PlacedText[]): number | null {
  for (let i = at; i < line.map.length; i += 1) {
    const ref = line.map[i];
    if (!ref) continue;
    const item = items[ref.item]!;
    const length = Array.from(item.str).length;
    return item.rect.x + (item.rect.width / Math.max(length, 1)) * ref.index;
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A chapter member's full name, and the two words a line must hold to be worth testing. */
export type NameMatcher = { pattern: RegExp; first: string; last: string };

/** Typographic apostrophes, read as the plain one in names and on the page. */
const APOSTROPHES = /[\u2018\u2019\u02bc]/g;
/** Words after a surname that aren't part of it. */
const SUFFIX = /^(?:jr|sr|ii|iii|iv|v)\.?$/i;

/** The lowercase words of a line or name, for the cheap check before a name's pattern runs. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}'-]+/gu) ?? [];
}

/**
 * Patterns for the chapter's full names: "First Last", with an optional middle
 * name or initial, and "Last, First". A one-word name is never matched alone,
 * since it is too often an ordinary word. A note in brackets ("(he/him)") and a
 * suffix ("Jr.", "III") are left off, so the surname is the surname.
 */
export function namePatterns(names: readonly RosterName[]): NameMatcher[] {
  const matchers: NameMatcher[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const words = name
      .normalize("NFKC")
      .replace(APOSTROPHES, "'")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .split(/[\s,]+/)
      .map((word) => word.replace(/^[^\p{L}]+|[^\p{L}'.-]+$/gu, ""))
      .filter((word) => word.length >= 2);
    while (words.length > 2 && SUFFIX.test(words[words.length - 1]!)) words.pop();
    if (words.length < 2) continue;
    const firstWord = words[0]!;
    const lastWord = words[words.length - 1]!.replace(/\.$/, "");
    const key = `${firstWord} ${lastWord}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const first = escapeRegExp(firstWord);
    const last = escapeRegExp(lastWord);
    matchers.push({
      pattern: new RegExp(
        `(?<![\\p{L}])(?:${first}(?:\\s+[\\p{L}]+\\.?)?\\s+${last}|${last}\\s*,\\s*${first})(?![\\p{L}])`,
        "giu",
      ),
      first: wordsOf(firstWord)[0] ?? firstWord.toLowerCase(),
      last: wordsOf(lastWord).at(-1) ?? lastWord.toLowerCase(),
    });
  }
  return matchers;
}

function unionBox(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/**
 * Boxes with any box that sits wholly inside another left out, such as an ID
 * number inside its "Student ID:" field. Overlapping boxes are kept apart:
 * joining two fields on neighbouring lines would black out the printed text
 * between them.
 */
export function dropContained(boxes: readonly Box[]): Box[] {
  const inside = (a: Box, b: Box) =>
    a.x >= b.x - 1 &&
    a.y >= b.y - 1 &&
    a.x + a.width <= b.x + b.width + 1 &&
    a.y + a.height <= b.y + b.height + 1;
  return boxes.filter(
    (box, index) =>
      !boxes.some(
        (other, at) =>
          at !== index && inside(box, other) && (!inside(other, box) || at < index),
      ),
  );
}

/**
 * The field after one label: where the name is typed or written. It starts
 * just past the label. When text follows straight on (a typed name, a run of
 * underscores), it ends with that text; otherwise it takes the default width.
 * Either way it ends before the next field on the line ("Section:", "Date:")
 * and before any later text with a gap in front of it, such as a course name
 * at the far end of a header line. Its height reaches up for handwriting but
 * stays off the printed lines above and below, unless they sit too close for
 * a name to fit, where it still covers the line itself.
 */
function fieldBox(
  page: SuggestPage,
  lines: readonly Line[],
  line: Line,
  end: number,
  stop: number | null,
): Box | null {
  const { items } = page;
  const lastChar = lastRef(line, end);
  if (!lastChar) return null;
  const labelItem = items[lastChar.item]!;
  const cell = labelItem.rect.width / Math.max(Array.from(labelItem.str).length, 1);
  const start = labelItem.rect.x + cell * (lastChar.index + 1) + LABEL_GAP;
  const stopX = stop === null ? null : charX(line, stop, items);
  const beforeStop = stopX === null ? Infinity : stopX - cell;
  let limit = Math.min(start + LABEL_FIELD_WIDTH, page.width - PAGE_MARGIN, beforeStop);

  // Text after the label, left to right: what runs straight on is the field's
  // content; the first piece after a gap ends the field.
  let covered = start;
  let ran = false;
  for (const box of spanBoxes(line, end, stop ?? line.text.length, items).sort((p, q) => p.x - q.x)) {
    if (box.x > covered + line.size * 1.5) {
      limit = Math.min(limit, box.x - cell);
      break;
    }
    covered = Math.max(covered, box.x + box.width);
    ran = true;
  }
  const right = ran ? Math.min(covered, beforeStop) : limit;
  if (right - start < cell) return null;

  const across = (other: Line) =>
    other.items.every((index) => items[index]!.upright) &&
    other.items.some((index) => {
      const rect = items[index]!.rect;
      return rect.x < right && rect.x + rect.width > start;
    });
  let top = line.baseline - line.size * FIELD_ABOVE;
  let bottom = line.baseline + line.size * FIELD_BELOW;
  for (const other of lines) {
    if (other === line || !across(other)) continue;
    if (other.baseline < line.baseline - line.size * 0.4) {
      top = Math.max(top, other.baseline + other.size * DESCENT + LABEL_GAP);
    } else if (other.baseline > line.baseline + line.size * 0.4) {
      bottom = Math.min(bottom, other.baseline - other.size * ASCENT - LABEL_GAP);
    }
  }
  // Lines set too tight for that still get a field that covers most of a
  // written name: a name matters more than the next line's searchability.
  top = Math.min(top, line.baseline - line.size * MIN_FIELD_ABOVE);
  bottom = Math.max(bottom, line.baseline + 1);
  return { x: start, y: top, width: right - start, height: bottom - top };
}

/** Suggested boxes for one page. */
export function suggestPageBoxes(page: SuggestPage, names: readonly NameMatcher[]): Box[] {
  const { items } = page;
  const found: Box[] = [];
  const lines = buildLines(items);
  for (const line of lines) {
    const upright = line.items.every((index) => items[index]!.upright);
    const labels = [...line.text.matchAll(LABEL)];
    labels.forEach((match, n) => {
      const end = match.index + match[0].length;
      FIELD_END.lastIndex = end;
      const stop = Math.min(
        FIELD_END.exec(line.text)?.index ?? Infinity,
        labels[n + 1]?.index ?? Infinity,
      );
      const stopIndex = Number.isFinite(stop) ? stop : null;
      if (!upright) {
        // Rotated text: the label's own run after it, whole. A blank field
        // there isn't found (#5250).
        found.push(...spanBoxes(line, end, stopIndex ?? line.text.length, items));
        return;
      }
      const box = fieldBox(page, lines, line, end, stopIndex);
      if (box) found.push(box);
    });

    const words = new Set(wordsOf(line.text));
    const patterns = [
      EMAIL,
      ID_NUMBER,
      ...names
        .filter((name) => words.has(name.first) && words.has(name.last))
        .map((name) => name.pattern),
    ];
    for (const pattern of patterns) {
      for (const match of line.text.matchAll(pattern)) {
        const spans = spanBoxes(line, match.index, match.index + match[0].length, items);
        // A match across runs on one line is one box, gaps included.
        found.push(...(upright ? [unionBox(spans)] : spans));
      }
    }
  }
  return dropContained(
    found
      .filter((box) => box.width > 0 && box.height > 0)
      .map((box) => clampBox(box, page.width, page.height))
      .filter((box) => box.width > 0 && box.height > 0),
  );
}

/** What the search found for one document in the queue. */
export type BoxSuggestion = {
  id: string;
  boxes: BoxesByPage;
  /** Characters of text in the file; -1 when its text couldn't be read. */
  textLength: number;
};

/** "page 2", "pages 1 and 3", "pages 1, 2 and 4", or "9 pages" past five. */
function pageList(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  if (pages.length > 5) return `${pages.length} pages`;
  return `pages ${pages.slice(0, -1).join(", ")} and ${pages.at(-1)}`;
}

/** The line above the editor saying what was boxed for the person, and what is still theirs to find. */
export function suggestionNote(suggestion: BoxSuggestion | null): string {
  if (!suggestion) return "Looking for names and IDs to box…";
  if (suggestion.textLength < 0) {
    return "Couldn't search this file for names. Box every name and ID by hand.";
  }
  const pages = Object.keys(suggestion.boxes)
    .map(Number)
    .sort((a, b) => a - b);
  const count = Object.values(suggestion.boxes).reduce((sum, list) => sum + list.length, 0);
  if (count > 0) {
    return `Boxed ${count} ${count === 1 ? "spot" : "spots"} on ${pageList(pages)}: a Name or ID line, an email, or a member's name. Check every page. A name written with no label isn't found.`;
  }
  if (suggestion.textLength < 40) {
    return "This file has no text to search, likely a scan, so nothing was boxed for you. Box every name and ID by hand.";
  }
  return "Found no Name line, ID or member's name to box. Check every page for handwriting.";
}
