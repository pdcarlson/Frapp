import { describe, expect, it } from "vitest";
import {
  EVENT_PARSE_BUDGET,
  exceedsParseBudget,
  IMAGE_PARSE_BUDGET,
  LABEL_PARSE_BUDGET,
} from "./markdown-parse-budget";
import { skipsMarkdownParse } from "./markdown";

// #2664. Bodies within the 10,000-character cap that micromark's inline
// resolvers took over a second to parse. The timings are remark-parse alone,
// Node 24, before this check existed. Each renderer's spec times its own
// pipeline on these; this pins that the scan catches them.
const CAP = 10_000;
const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

const MOTIVATING: Array<[string, string]> = [
  ["an underscore run (1.8 s)", "_".repeat(4999) + "a" + "_".repeat(4999)],
  ["a strong run (1.3 s)", "**".repeat(2499) + "a" + "**".repeat(2499)],
  [
    "open brackets closed by links (1.1 s)",
    "[".repeat(3000) + "a" + "](u)".repeat(1000),
  ],
  [
    "alternating openers closed in reverse (1.3 s)",
    (() => {
      let open = "";
      let close = "";
      for (let i = 0; i < 1600; i += 1) {
        const marker = i % 2 ? "_" : "*";
        open += `${marker}a `;
        close = ` a${marker}` + close;
      }
      return open + "x" + close;
    })(),
  ],
  ["brackets (1.6 s)", "[".repeat(4999) + "a" + "]".repeat(4999)],
  ["star-a pairs (0.3 s)", "*a".repeat(2400) + "x" + "a*".repeat(2400)],
  ["a star-a run (0.2 s)", "*a".repeat(5000)],
  ["nested images (1.2 s)", "![".repeat(2499) + "a" + "](u)".repeat(1249)],
  // Found while setting the budgets: failing closers walk back over every
  // event, and escapes and entities multiply the events.
  [
    "closers after escapes (0.3 s)",
    fill("\\&", CAP - 3000) + "a* ".repeat(1000),
  ],
  [
    "unmatched `]` after entities (0.2 s)",
    fill("&amp;", CAP - 3000) + "] ".repeat(1500),
  ],
];

describe("exceedsParseBudget", () => {
  it.each(MOTIVATING)("catches %s", (_label, body) => {
    expect(body.length).toBeLessThanOrEqual(CAP);
    expect(exceedsParseBudget(body)).toBe(true);
    expect(skipsMarkdownParse(body)).toBe(true);
  });

  it("leaves a long, heavily formatted paragraph alone", () => {
    // 60 bold phrases, 30 links and 30 entities in one 10,000-character
    // paragraph: about three quarters of the event budget.
    const unit =
      "Some **bold** words, more **bold** here, a [link](https://x.test/p) &amp; ";
    const formatted = unit.repeat(30);
    const body =
      formatted + fill("plain prose goes on. ", CAP - formatted.length);
    expect(body.length).toBe(CAP);
    expect(exceedsParseBudget(body)).toBe(false);
    expect(skipsMarkdownParse(body)).toBe(false);
  });

  it.each([
    [
      "short chat",
      "hey **all**, the _meeting_ moved to [the doc](https://x.test)",
    ],
    ["code spans", fill("run `npm ci` then `npm test` and ", CAP)],
    ["a 40-item list", "- **item** with a [link](https://x.test)\n".repeat(40)],
    [
      "paragraphs of bold",
      fill("**Heads up:** dues are due _Friday_.\n\n", CAP),
    ],
    [
      "an image or two",
      "look ![a](https://x.test/a.png) and ![b](https://x.test/b.png)",
    ],
    ["a divider of underscores", "above\n\n" + "_".repeat(40) + "\n\nbelow"],
  ])("leaves %s alone", (_label, body) => {
    expect(exceedsParseBudget(body)).toBe(false);
  });

  it("measures each paragraph on its own", () => {
    // One paragraph of closers after escapes is over; split by blank lines
    // into paragraphs that are each well inside, it isn't.
    const para = fill("\\&", 600) + "a* ".repeat(60);
    expect(
      exceedsParseBudget(Array.from({ length: 10 }, () => para).join("")),
    ).toBe(true);
    expect(
      exceedsParseBudget(Array.from({ length: 10 }, () => para).join("\n\n")),
    ).toBe(false);
    // A line of spaces is blank too.
    expect(
      exceedsParseBudget(
        Array.from({ length: 10 }, () => para).join("\n \t\n"),
      ),
    ).toBe(false);
  });

  it("over-counts a long list, which it reads as one paragraph", () => {
    // Each list item is its own paragraph to micromark, but a list's lines
    // aren't separated by blank lines, so the estimate adds them up. Telling a
    // list item from paragraph continuation text is where CommonMark's rules
    // get subtle, and a wrong split would hide a costly paragraph, so the scan
    // doesn't try. A list this long with this much formatting per item renders
    // as its raw text.
    const item = "- **item** with a [link](https://x.test)\n";
    expect(exceedsParseBudget(item.repeat(50))).toBe(false);
    expect(exceedsParseBudget(item.repeat(70))).toBe(true);
    expect(exceedsParseBudget(item.repeat(70).replaceAll("\n", "\n\n"))).toBe(
      false,
    );
  });

  it("reads CRLF as one line ending, so it can't split a paragraph", () => {
    // Read as two, the empty line between CR and LF would end the paragraph at
    // every line and hide this body from the estimate.
    const line = "a* a* a* a* a* a* a* a* a* a*";
    const body = Array.from({ length: 300 }, () => line).join("\r\n");
    expect(body.length).toBeLessThanOrEqual(CAP);
    expect(exceedsParseBudget(body)).toBe(true);
    expect(exceedsParseBudget(body.replaceAll("\r\n", "\n"))).toBe(true);
  });

  it("keeps each budget independent", () => {
    // The label budget alone: few constructs, but every `]` serializes a long
    // label.
    const labels = "[" + fill("abc ", 9_000) + "]".repeat(120);
    expect(120 * 121).toBeLessThan(EVENT_PARSE_BUDGET);
    expect(120 * labels.length).toBeGreaterThan(LABEL_PARSE_BUDGET);
    expect(exceedsParseBudget(labels)).toBe(true);
    // The image budget alone: six image openers in a long paragraph.
    const images = "![".repeat(6) + fill("abc ", 9_000);
    expect(6 * images.length).toBeGreaterThan(IMAGE_PARSE_BUDGET);
    expect(exceedsParseBudget(images)).toBe(true);
  });
});
