/**
 * Whether a message body would cost remark too much to parse, read straight
 * off the source in one linear pass (#2664). A body that would renders as its
 * raw text, as `opensTooManyContainers` already arranges for container
 * markers: `skipsMarkdownParse` in `markdown.ts` asks both.
 *
 * **The exposure.** Message bodies are capped at 10,000 characters, but
 * micromark's inline resolvers are quadratic on some of them, and both clients
 * parse every text message on the main JS thread: web's `MessageMarkdown` and
 * mobile's `parseMessageMarkdown`, which runs on Hermes with no JIT. Measured
 * in Node 24 (micromark 4.0.2), cap-length bodies of `_` or `**` runs took
 * 1.0–1.8 s, and `"[".repeat(4999) + "a" + "]".repeat(4999)` 1.6 s, against
 * 2–30 ms for ordinary bodies of the same length. Every member who opens the
 * channel pays that, once per mount. The depth cap can't help: it runs after
 * the parse, and several of these shapes are not deep.
 *
 * **What costs.** micromark resolves inline content one paragraph at a time,
 * so every cost below is bounded by one paragraph:
 *
 * - **Emphasis** (`resolveAllAttention`). Each `*` or `_` run that can close
 *   walks back over the paragraph's events looking for an opener, and each
 *   match it makes slices out every event between the two. So the work grows
 *   with the paragraph's delimiters times its events. Escapes, entities, code
 *   spans and line endings each add events, which is why a few hundred `"a* "`
 *   closers after a run of `\&` escapes are already slow.
 * - **Link and image labels** (`labelEnd`). A label that resolves slices out
 *   its events the same way. And each `]` that closes a label serializes the
 *   whole label to look it up as a reference definition, so the work also
 *   grows with the `]` count times the paragraph's length.
 * - **Nested images.** Images nest where links can't, and each level's alt
 *   text is built from everything inside it, so the work grows with the
 *   image openers times the length.
 * - **Raw HTML** (`htmlText`). An unclosed `<?`, `<!--` or `<!X` scans to the
 *   end of the paragraph looking for its closer before it gives up, so the
 *   work grows with those openers times the length, and faster across line
 *   endings, which the scan tokenizes. A tag opener (`<a`, `</a`) stops at its
 *   line or its attributes and measured cheap at any count.
 * - **Container runs** (block, not inline). micromark re-checks every open
 *   block quote and list item on each line, and a line with no marker of its
 *   own continues a paragraph inside them lazily, which is quadratic in the
 *   lines. See `MAX_CONTAINER_RUN_LINES`.
 *
 * **The estimate.** Per paragraph, three products and a count, each with a
 * budget:
 *
 * - the `*`, `_` and `]` count, plus each `<!` or `<?` weighted four times,
 *   times the characters that can start a construct (an upper bound on the
 *   events);
 * - the `]`, `<!` and `<?` count times the length;
 * - the `![` count times the length;
 * - the container markers and lines from its first container line on.
 *
 * Any one over its budget, and the body skips the parse. An `_` between two
 * ASCII letters or digits is left out of the first count: it can neither open
 * nor close emphasis, so it never starts a walk, and leaving it out keeps
 * snake_case names in prose and code from counting as formatting. It is still
 * a construct, since it still adds events.
 *
 * **It runs high, never low.** A paragraph ends at a blank line, and at a
 * bullet or `1.` list item with content, indented at most three spaces:
 * CommonMark always lets those interrupt a paragraph, so a long bulleted list
 * is measured item by item. Anything else that might end one is ignored: a
 * `2.` item or a `>` line can be a lazy continuation, and a line that looks
 * like a code fence can sit inside an HTML block, so a split there could hide
 * a costly paragraph. Every delimiter counts, including ones inside code or
 * escaped, for the same reason. Over-counting costs one message its
 * formatting; under-counting costs every reader the parse. What it
 * over-counts in practice is long block content without blank lines: a
 * numbered list of about 70 items that each carry bold, or a code block heavy
 * with `*` or `<?` (PHP, HTML comments), renders as raw text.
 *
 * **The budgets** were set by searching shape families for the slowest body
 * that stays under them: runs, nests, failing closers, labels, images and
 * unclosed raw HTML, each padded with text, entities, escapes, code spans, raw
 * HTML, snake_case or short lines; and lazy runs and long, nested or padded
 * lists. Best of three runs in Node 24 on the machine that set them, the
 * slowest inline bodies took 60–85 ms, all of them bodies of 5,000 short lines
 * that take 45–90 ms with no delimiters at all, and the slowest block bodies
 * about 65 ms. The spread between runs is wide, so treat these as a scale,
 * not a bound. Ordinary chat sits inside: a
 * 10,000-character paragraph with 60 bold phrases, 30 links and 30 entities
 * estimates at about 90% of the event budget, and a message with several
 * paragraphs is measured one paragraph at a time. Image openers get the
 * tightest budget, 5 per 10,000 characters, because an image isn't in the
 * chat allowlist and renders nothing anyway.
 * `markdown-parse-budget.spec.ts` pins the shapes that motivated this.
 */

import { isDigit, isMarkerBoundary } from "./markdown-depth-cap";

/**
 * The event estimate a paragraph may reach: its `*`, `_` and `]` characters
 * and weighted `<!` and `<?` openers, times its construct-starting characters.
 */
export const EVENT_PARSE_BUDGET = 100_000;

/**
 * How many emphasis delimiters one `<!` or `<?` weighs in the event estimate.
 * A failed raw-HTML scan tokenizes every line ending it crosses, which
 * measured at about four times a closer's walk over the same events.
 */
const HTML_OPENER_WEIGHT = 4;

/**
 * The scan estimate a paragraph may reach: its `]`, `<!` and `<?` counts times
 * its length. Each starts a scan that can run to the paragraph's end.
 */
export const SCAN_PARSE_BUDGET = 1_000_000;

/** The image estimate a paragraph may reach: its `![` count times its length. */
export const IMAGE_PARSE_BUDGET = 50_000;

/**
 * Characters that can start an inline construct, so each can add events a
 * resolver walks: emphasis and label delimiters, escapes, entities, code
 * spans, autolinks and raw HTML, image openers, and line endings.
 */
function startsConstruct(char: string): boolean {
  switch (char) {
    case "*":
    case "_":
    case "[":
    case "]":
    case "!":
    case "\\":
    case "&":
    case "`":
    case "<":
    case "\n":
    case "\r":
      return true;
    default:
      return false;
  }
}

/** An ASCII letter or digit: never whitespace or punctuation to micromark. */
function isAsciiWordChar(char: string | undefined): boolean {
  return (
    char !== undefined &&
    ((char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      (char >= "0" && char <= "9"))
  );
}

/**
 * Whether the `_` at `index` sits between two ASCII letters or digits, where
 * CommonMark lets it neither open nor close emphasis. Anything else beside it,
 * including a non-ASCII character that might be punctuation, counts it.
 */
function isIntraword(content: string, index: number): boolean {
  return (
    isAsciiWordChar(content[index - 1]) && isAsciiWordChar(content[index + 1])
  );
}

/**
 * How many lines a body may run from its first container line (a block quote
 * or list marker) to its end, each weighing its markers, or one if it has
 * none. micromark re-checks every open container on each line, and a line
 * with no marker of its own continues a paragraph inside them lazily, which
 * is quadratic: `">a\n" + "b\n".repeat(4998)` took 0.45–1 s. Past 1,000
 * the body skips the parse. That also bounds long or deeply nested lists,
 * which are linear but slow per marker (2,500 items took 115–130 ms).
 *
 * **Why to the end of the body, not the paragraph.** A list item stays open
 * across a blank line, so a later paragraph inside it can run lazily with no
 * marker line of its own (`"- x\n\n  b\n" + "c\n".repeat(4994)` took about
 * 1 s). Telling when every container has closed is block parsing, and a
 * wrong guess hides the run, so the count never stops. That also keeps runs
 * split by blank lines from adding up past the cap unseen.
 */
export const MAX_CONTAINER_RUN_LINES = 1_000;

interface LineStart {
  /** How many block quote and list markers the line opens with. */
  markers: number;
  /**
   * The line is a list item CommonMark always lets interrupt a paragraph, so
   * it ends the one before it: a bullet, or an ordered item numbered `1`, with
   * content after the marker, indented at most three spaces and no tab. Any
   * other marker line may be a paragraph's lazy continuation, so it doesn't.
   */
  startsItem: boolean;
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

/**
 * The end of the block quote or list marker at `at`, or -1 when there isn't
 * one; and whether it is a marker that may interrupt a paragraph.
 */
function readMarker(
  content: string,
  at: number,
  end: number,
): { after: number; interrupts: boolean } {
  const char = content[at];
  if (char === ">") return { after: at + 1, interrupts: false };
  let after = -1;
  let interrupts = true;
  if (char === "-" || char === "+" || char === "*") {
    after = at + 1;
  } else if (isDigit(char)) {
    let digits = at;
    while (digits < end && digits - at < 9 && isDigit(content[digits])) {
      digits += 1;
    }
    if (content[digits] === "." || content[digits] === ")") {
      after = digits + 1;
      interrupts = digits === at + 1 && char === "1";
    }
  }
  if (after !== -1 && char !== ">" && !isMarkerBoundary(content, after)) {
    after = -1;
  }
  return { after, interrupts };
}

/** Reads the markers, if any, that the line from `start` to `end` opens with. */
function readLineStart(content: string, start: number, end: number): LineStart {
  let at = start;
  let tab = false;
  while (at < end && isSpace(content[at])) {
    if (content[at] === "\t") tab = true;
    at += 1;
  }
  const indent = at - start;
  const first = readMarker(content, at, end);
  if (first.after === -1) return { markers: 0, startsItem: false };

  // Count the markers that follow, as `opensTooManyContainers` does.
  let markers = 0;
  let next = at;
  for (;;) {
    const marker = readMarker(content, next, end);
    if (marker.after === -1) break;
    markers += 1;
    next = marker.after;
    while (next < end && isSpace(content[next])) next += 1;
  }

  let text = first.after;
  while (text < end && isSpace(content[text])) text += 1;
  const isListItem = content[at] !== ">";
  return {
    markers,
    startsItem:
      isListItem && first.interrupts && text < end && !tab && indent <= 3,
  };
}

/** Whether any paragraph of `content` estimates over one of its budgets. */
export function exceedsParseBudget(content: string): boolean {
  let emphasis = 0;
  let constructs = 0;
  let labelEnds = 0;
  let htmlOpeners = 0;
  let images = 0;
  let length = 0;
  // Container markers and lines since the body's first container line, or -1
  // before one. Unlike the counts above, a blank line never resets it.
  let containerRun = -1;

  const resetInline = () => {
    emphasis = 0;
    constructs = 0;
    labelEnds = 0;
    htmlOpeners = 0;
    images = 0;
    length = 0;
  };
  const overBudget = () =>
    (emphasis + labelEnds + HTML_OPENER_WEIGHT * htmlOpeners) * constructs >
      EVENT_PARSE_BUDGET ||
    (labelEnds + htmlOpeners) * length > SCAN_PARSE_BUDGET ||
    images * length > IMAGE_PARSE_BUDGET ||
    containerRun > MAX_CONTAINER_RUN_LINES;

  // micromark drops a byte-order mark at the start of a document. Read past
  // it, or it would hide the first line's markers.
  let start = content.startsWith("\uFEFF") ? 1 : 0;
  while (start <= content.length) {
    let end = start;
    while (
      end < content.length &&
      content[end] !== "\n" &&
      content[end] !== "\r"
    ) {
      end += 1;
    }

    let blank = true;
    for (let i = start; i < end; i += 1) {
      if (content[i] !== " " && content[i] !== "\t") {
        blank = false;
        break;
      }
    }

    if (blank) {
      // A blank line ends the paragraph. It may sit inside an open container.
      resetInline();
      // The empty "line" after a trailing line ending isn't one.
      if (containerRun !== -1 && start < content.length) containerRun += 1;
    } else {
      const line = readLineStart(content, start, end);
      if (line.startsItem) resetInline();
      // Each marker opens a container micromark re-checks on every line after
      // it; a line with none continues the run lazily and weighs one.
      if (line.markers > 0 && containerRun === -1) containerRun = 0;
      if (containerRun !== -1) containerRun += Math.max(1, line.markers);

      for (let i = start; i < end; i += 1) {
        const char = content[i]!;
        length += 1;
        if (!startsConstruct(char)) continue;
        constructs += 1;
        if (char === "*" || (char === "_" && !isIntraword(content, i))) {
          emphasis += 1;
        } else if (char === "]") {
          labelEnds += 1;
        } else if (
          char === "<" &&
          (content[i + 1] === "!" || content[i + 1] === "?")
        ) {
          htmlOpeners += 1;
        } else if (
          char === "!" &&
          content[i + 1] === "[" &&
          content[i - 1] !== "<"
        ) {
          // `<![CDATA[` is a raw-HTML opener, counted above, not an image.
          images += 1;
        }
      }
      if (end < content.length) {
        // The line ending: a construct, and part of the paragraph.
        constructs += 1;
        length += 1;
      }
    }
    if (overBudget()) return true;
    if (end >= content.length) break;
    // CRLF is one line ending. Read as two, the empty "line" between them
    // would end the paragraph at every line and hide it from the estimate.
    start = end + (content[end] === "\r" && content[end + 1] === "\n" ? 2 : 1);
  }
  return false;
}
