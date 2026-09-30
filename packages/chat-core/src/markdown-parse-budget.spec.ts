import { describe, expect, it } from "vitest";
import {
  EVENT_PARSE_BUDGET,
  exceedsParseBudget,
  MAX_CONTAINER_RUN_LINES,
  IMAGE_PARSE_BUDGET,
  SCAN_PARSE_BUDGET,
} from "./markdown-parse-budget";
import { skipsMarkdownParse } from "./markdown";
import {
  COSTLY_MARKDOWN_BODIES,
  NEAR_BUDGET_MARKDOWN_BODY,
} from "./test/markdown-parse-budget.fixtures";

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

  it("measures each bullet or `1.` item as its own paragraph", () => {
    // A list item that CommonMark always lets interrupt a paragraph ends the
    // one before it, so a long formatted list doesn't add up.
    const bullet = "- **Alex Johnson** with a [link](https://x.test)\n";
    expect(exceedsParseBudget(bullet.repeat(200))).toBe(false);
    expect(
      exceedsParseBudget(
        "1. " + "**Alex** ".repeat(20) + "\n" + "1. **b**\n".repeat(200),
      ),
    ).toBe(false);
  });

  it("does not split at a marker line that may be a lazy continuation", () => {
    // `14.` can't interrupt a paragraph, and a `>` line continues a quoted
    // one, so neither may reset the count: a body could otherwise spread one
    // costly paragraph across such lines.
    const closers = "a* ".repeat(40);
    const pad = fill("\\&", 400);
    expect(exceedsParseBudget((pad + closers + "\n14. ").repeat(12))).toBe(
      true,
    );
    expect(exceedsParseBudget(("> " + pad + closers + "\n").repeat(12))).toBe(
      true,
    );
    // Indented four spaces, or by a tab, a bullet is continuation text too.
    expect(exceedsParseBudget((pad + closers + "\n    - ").repeat(12))).toBe(
      true,
    );
    expect(exceedsParseBudget((pad + closers + "\n\t- ").repeat(12))).toBe(
      true,
    );
    // The same lines as bullets are separate paragraphs.
    expect(exceedsParseBudget(("- " + pad + closers + "\n").repeat(12))).toBe(
      false,
    );
  });

  it("over-counts a long numbered list past 1, which it can't split", () => {
    // `2.` onwards may be lazy continuation in some contexts, so a numbered
    // list adds up where a bulleted one doesn't.
    const numbered = Array.from(
      { length: 80 },
      (_, i) => `${i + 1}. **Alex Johnson**\n`,
    ).join("");
    expect(exceedsParseBudget(numbered)).toBe(true);
    expect(
      exceedsParseBudget(numbered.split("\n").slice(0, 40).join("\n")),
    ).toBe(false);
  });

  it("caps a paragraph's run of lines after a container line", () => {
    // Lazy continuation lines are quadratic: `">a\n" + "b\n".repeat(4998)`
    // took 450 ms, with no delimiter anywhere.
    const lazy = (lines: number) => ">a\n" + "b\n".repeat(lines - 1);
    expect(exceedsParseBudget(lazy(MAX_CONTAINER_RUN_LINES))).toBe(false);
    expect(exceedsParseBudget(lazy(MAX_CONTAINER_RUN_LINES + 1))).toBe(true);
    expect(exceedsParseBudget("- a\n" + "b\n".repeat(4998))).toBe(true);
    // Long lists too: linear, but 2,500 items took 130 ms.
    expect(exceedsParseBudget("- a\n".repeat(2500))).toBe(true);
    expect(exceedsParseBudget("-\n".repeat(5000))).toBe(true);
    // Plain lines open no container, and a blank line ends the run.
    expect(exceedsParseBudget("b\n".repeat(5000))).toBe(false);
    expect(
      exceedsParseBudget((">a\n" + "b\n".repeat(600) + "\n").repeat(4)),
    ).toBe(false);
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
    expect(exceedsParseBudget(closers("."))).toBe(true);
    expect(exceedsParseBudget(fill("\\&", 7_000) + "a_b ".repeat(750))).toBe(
      false,
    );
    expect(exceedsParseBudget(fill("\\&", 7_000) + "é_é ".repeat(750))).toBe(
      true,
    );
  });

  it("keeps each budget independent", () => {
    // The scan budget alone: few constructs, but every `]` serializes a long
    // label.
    const labels = "[" + fill("abc ", 9_000) + "]".repeat(120);
    expect(120 * 121).toBeLessThan(EVENT_PARSE_BUDGET);
    expect(120 * labels.length).toBeGreaterThan(SCAN_PARSE_BUDGET);
    expect(exceedsParseBudget(labels)).toBe(true);
    // The scan budget alone, through raw-HTML openers: 150 `<?` before plain
    // text, weighted well inside the event budget.
    const html = "x " + "<?".repeat(150) + fill("abc ", 8_000);
    expect(4 * 150 * 152).toBeLessThan(EVENT_PARSE_BUDGET);
    expect(150 * html.length).toBeGreaterThan(SCAN_PARSE_BUDGET);
    expect(exceedsParseBudget(html)).toBe(true);
    expect(
      exceedsParseBudget("x " + "<?".repeat(90) + fill("abc ", 8_000)),
    ).toBe(false);
    // The event budget through raw-HTML openers, which weigh four delimiters
    // each: 100 openers among 300 constructs trip it only at that weight.
    const weighted = "&amp;".repeat(200) + "<?".repeat(100);
    expect(100 * 300).toBeLessThan(EVENT_PARSE_BUDGET);
    expect(4 * 100 * 300).toBeGreaterThan(EVENT_PARSE_BUDGET);
    expect(100 * weighted.length).toBeLessThan(SCAN_PARSE_BUDGET);
    expect(exceedsParseBudget(weighted)).toBe(true);
    expect(exceedsParseBudget("&amp;".repeat(200) + "<?".repeat(60))).toBe(
      false,
    );
    // The image budget alone: six image openers in a long paragraph.
    const images = "![".repeat(6) + fill("abc ", 9_000);
    expect(6 * images.length).toBeGreaterThan(IMAGE_PARSE_BUDGET);
    expect(exceedsParseBudget(images)).toBe(true);
    // `<![CDATA[` is a raw-HTML opener, not an image.
    expect(
      exceedsParseBudget(
        "x " + "<![CDATA[a]]> ".repeat(6) + fill("abc ", 8_000),
      ),
    ).toBe(false);
  });
});
