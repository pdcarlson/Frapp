import { describe, expect, it } from "vitest";
import {
  EVENT_PARSE_BUDGET,
  exceedsParseBudget,
  IMAGE_PARSE_BUDGET,
  SCAN_PARSE_BUDGET,
} from "./markdown-parse-budget";
import { skipsMarkdownParse } from "./markdown";
import {
  COSTLY_MARKDOWN_BODIES,
  NEAR_BUDGET_MARKDOWN_BODY,
} from "./markdown-parse-budget.fixtures";

// #2664. The bodies are shared with the renderer specs, which time their own
// pipelines on them; this pins that the scan catches them.
const CAP = 10_000;
const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

describe("exceedsParseBudget", () => {
  it.each(COSTLY_MARKDOWN_BODIES.map((c) => [c.label, c.body]))(
    "catches %s",
    (_label, body) => {
      expect(body.length).toBeLessThanOrEqual(CAP);
      expect(exceedsParseBudget(body)).toBe(true);
      expect(skipsMarkdownParse(body)).toBe(true);
    },
  );

  it("lets the near-budget body the renderer specs time through", () => {
    expect(skipsMarkdownParse(NEAR_BUDGET_MARKDOWN_BODY)).toBe(false);
  });

  it("leaves a long, heavily formatted paragraph alone", () => {
    // 60 bold phrases, 30 links and 30 entities in one 10,000-character
    // paragraph: about 90% of the event budget.
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
    // snake_case: an `_` between word characters can't open or close.
    [
      "a long snake_case code block",
      "```python\n" +
        "    user_id = get_user_id(request_body)\n".repeat(240) +
        "```",
    ],
    [
      "snake_case prose",
      fill("set the_env_var and my_config_value then ", CAP),
    ],
    [
      "a long JSX code block",
      "```tsx\n" +
        "  <Item key={item.id} onClick={() => select(item)} />\n".repeat(150) +
        "```",
    ],
    [
      "a long HTML code block",
      "```html\n" +
        '<div class="row"><span>{{ value }}</span></div>\n'.repeat(190) +
        "```",
    ],
    ["hearts and comparisons", fill("<3 love it, and a < b too ", CAP)],
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

  it("still counts an `_` beside anything but an ASCII letter or digit", () => {
    // `_` beside a space, punctuation or a non-ASCII character may open or
    // close, so it counts. Only the ASCII word-character case is left out.
    const closers = (sep: string) =>
      fill("\\&", 7_000) + `a${sep}_ `.repeat(750);
    expect(exceedsParseBudget(closers(""))).toBe(true);
    expect(exceedsParseBudget(fill("\\&", 7_000) + "a_b ".repeat(750))).toBe(
      false,
    );
    expect(exceedsParseBudget(fill("\\&", 7_000) + "é_é ".repeat(750))).toBe(
      true,
    );
  });

  it("keeps each budget independent", () => {
    // The label budget alone: few constructs, but every `]` serializes a long
    // label.
    const labels = "[" + fill("abc ", 9_000) + "]".repeat(120);
    expect(120 * 121).toBeLessThan(EVENT_PARSE_BUDGET);
    expect(120 * labels.length).toBeGreaterThan(SCAN_PARSE_BUDGET);
    expect(exceedsParseBudget(labels)).toBe(true);
    // The image budget alone: six image openers in a long paragraph.
    const images = "![".repeat(6) + fill("abc ", 9_000);
    expect(6 * images.length).toBeGreaterThan(IMAGE_PARSE_BUDGET);
    expect(exceedsParseBudget(images)).toBe(true);
  });
});
