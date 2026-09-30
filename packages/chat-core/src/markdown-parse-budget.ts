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
 * 1.3–1.8 s, and `"[".repeat(4999) + "a" + "]".repeat(4999)` 1.6 s, against
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
 *
 * **The estimate.** Per paragraph, three products, each with a budget:
 *
 * - the `*`, `_` and `]` count, plus each `<!` or `<?` weighted four times,
 *   times the characters that can start a construct (an upper bound on the
 *   events);
 * - the `]`, `<!` and `<?` count times the length;
 * - the `![` count times the length.
 *
 * Any one over its budget, and the body skips the parse. An `_` between two
 * ASCII letters or digits is left out of the first count: it can neither open
 * nor close emphasis, so it never starts a walk, and leaving it out keeps
 * snake_case names in prose and code from counting as formatting. It is still
 * a construct, since it still adds events.
 *
 * **It runs high, never low.** Paragraphs are split only at blank lines,
 * which is where CommonMark ends one; a block quote, list item or code fence
 * can end one sooner. Telling those apart is where CommonMark's rules get
 * subtle (an HTML block can make a line that looks like a fence into text),
 * and a wrong split would hide a costly paragraph, so the scan doesn't try.
 * Every delimiter counts, including ones inside code or escaped, for the same
 * reason. Over-counting costs one message its formatting; under-counting
 * costs every reader the parse. What it over-counts in practice is long block
 * content without blank lines: a list of about 55 items that each carry bold
 * and a link renders as raw text.
 *
 * **The budgets** were set by searching shape families for the slowest body
 * that stays under them: runs, nests, failing closers, labels, images and
 * unclosed raw HTML, each padded with text, entities, escapes, code spans, raw
 * HTML, snake_case or short lines. The slowest took 60–75 ms in Node 24, and
 * all of them were bodies of 5,000 short lines, which take about 55 ms with no
 * delimiters at all. That is the inline cost. Block structure isn't
 * estimated: its parse is linear, but a cap-length list of 2,500 one-letter
 * items still takes about 130 ms. Ordinary chat sits inside: a
 * 10,000-character paragraph with 60 bold phrases, 30 links and 30 entities
 * estimates at about 90% of the event budget, and a message with several
 * paragraphs is measured one paragraph at a time. Image openers get the
 * tightest budget, 5 per 10,000 characters, because an image isn't in the
 * chat allowlist and renders nothing anyway.
 * `markdown-parse-budget.spec.ts` pins the shapes that motivated this.
 */

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

/** Whether any paragraph of `content` estimates over one of the three budgets. */
export function exceedsParseBudget(content: string): boolean {
  let emphasis = 0;
  let constructs = 0;
  let labelEnds = 0;
  let htmlOpeners = 0;
  let images = 0;
  let length = 0;
  // Whether the current line holds anything but spaces and tabs so far. A line
  // that holds nothing else is blank, and a blank line ends the paragraph.
  let lineHasText = false;

  const overBudget = () =>
    (emphasis + labelEnds + HTML_OPENER_WEIGHT * htmlOpeners) * constructs >
      EVENT_PARSE_BUDGET ||
    (labelEnds + htmlOpeners) * length > SCAN_PARSE_BUDGET ||
    images * length > IMAGE_PARSE_BUDGET;

  for (let i = 0; i <= content.length; i += 1) {
    const char = content[i];
    // CRLF is one line ending. Read as two, the empty "line" between them
    // would end the paragraph at every line, and the estimate would miss a
    // paragraph written with them.
    if (char === "\r" && content[i + 1] === "\n") continue;
    if (char === undefined || char === "\n" || char === "\r") {
      if (overBudget()) return true;
      if (char === undefined) break;
      if (!lineHasText) {
        emphasis = 0;
        constructs = 0;
        labelEnds = 0;
        htmlOpeners = 0;
        images = 0;
        length = 0;
      } else {
        constructs += 1;
        length += 1;
      }
      lineHasText = false;
      continue;
    }
    length += 1;
    if (char !== " " && char !== "\t") lineHasText = true;
    if (!startsConstruct(char)) continue;
    constructs += 1;
    if (char === "*" || (char === "_" && !isIntraword(content, i)))
      emphasis += 1;
    else if (char === "]") labelEnds += 1;
    else if (
      char === "<" &&
      (content[i + 1] === "!" || content[i + 1] === "?")
    ) {
      htmlOpeners += 1;
    } else if (char === "!" && content[i + 1] === "[") images += 1;
  }
  return false;
}
