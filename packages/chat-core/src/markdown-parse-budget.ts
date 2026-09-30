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
 *
 * **The estimate.** Per paragraph: the `*`, `_` and `]` count times the
 * characters that can start a construct (an upper bound on the events); the
 * `]` count times the length; and the `![` count times the length. Any of the
 * three over its budget, and the body skips the parse. Paragraphs are split at
 * blank lines, which is where CommonMark ends one; a block quote or list can
 * end one sooner, so the estimate only ever runs high. The cost of that is a
 * long list: each item is its own paragraph to micromark, but the scan adds up
 * a list's lines, so about 60 items that each carry bold and a link render as
 * raw text. Telling a list item from paragraph continuation text is where
 * CommonMark's rules get subtle, and a wrong split would hide a costly
 * paragraph, so the scan doesn't try. It counts every
 * delimiter, including ones inside code spans or escaped, for the same reason.
 * Over-counting costs one message its formatting; under-counting costs every
 * reader the parse.
 *
 * **The budgets** were set by searching shape families for the slowest body
 * that stays under them (runs, nests, failing closers and labels, each padded
 * with text, entities, escapes, code spans, raw HTML or short lines). The
 * slowest took about 70 ms in Node 24, and those were all bodies of 5,000
 * short lines, which take about 55 ms with no delimiters at all. Ordinary chat
 * sits well inside: a 10,000-character paragraph with 60 bold phrases, 30
 * links and 30 entities estimates at about three quarters of the event
 * budget, and a
 * message with several paragraphs is measured one paragraph at a time. Image
 * openers get the tightest budget, 5 per 10,000 characters, because an image
 * isn't in the chat allowlist and renders nothing anyway.
 * `markdown-parse-budget.spec.ts` pins the shapes that motivated this.
 */

/**
 * The event estimate a paragraph may reach: its `*`, `_` and `]` characters
 * times its construct-starting characters.
 */
export const EVENT_PARSE_BUDGET = 120_000;

/** The label estimate a paragraph may reach: its `]` count times its length. */
export const LABEL_PARSE_BUDGET = 1_000_000;

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

/** Whether any paragraph of `content` estimates over one of the three budgets. */
export function exceedsParseBudget(content: string): boolean {
  let emphasis = 0;
  let constructs = 0;
  let labelEnds = 0;
  let images = 0;
  let length = 0;
  // Whether the current line holds anything but spaces and tabs so far. A line
  // that holds nothing else is blank, and a blank line ends the paragraph.
  let lineHasText = false;

  const overBudget = () =>
    (emphasis + labelEnds) * constructs > EVENT_PARSE_BUDGET ||
    labelEnds * length > LABEL_PARSE_BUDGET ||
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
    if (char === "*" || char === "_") emphasis += 1;
    else if (char === "]") labelEnds += 1;
    else if (char === "!" && content[i + 1] === "[") images += 1;
  }
  return false;
}
