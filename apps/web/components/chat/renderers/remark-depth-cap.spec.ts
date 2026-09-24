import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_MARKDOWN_DEPTH, opensTooManyContainers } from "./remark-depth-cap";

// #2209. The scan decides, before remark parses anything, that a body would
// nest past the depth cap. It exists because remark's parse is quadratic in
// the containers one line opens: a cap-length `"- "` body took 6.8 s.
describe("opensTooManyContainers", () => {
  const cap = MAX_MESSAGE_MARKDOWN_DEPTH;

  it.each([
    ["block quotes", "> "],
    ["bare block quotes", ">"],
    ["dash list items", "- "],
    ["plus list items", "+ "],
    ["star list items", "* "],
    ["ordered list items", "1. "],
    ["paren-ordered list items", "12) "],
    ["tab-separated list items", "-\t"],
    ["quotes and lists mixed", "> - "],
  ])("trips on one line of %s past the cap", (_label, marker) => {
    expect(opensTooManyContainers(marker.repeat(cap + 1) + "hi")).toBe(true);
  });

  it("does not trip on a line of exactly the cap", () => {
    expect(opensTooManyContainers("> ".repeat(cap) + "hi")).toBe(false);
    expect(opensTooManyContainers("- ".repeat(cap) + "hi")).toBe(false);
  });

  it("counts each line on its own", () => {
    const line = "- ".repeat(cap) + "hi";
    expect(opensTooManyContainers(`${line}\n${line}\n${line}`)).toBe(false);
  });

  it.each([
    ["a lone CR", "\r"],
    ["CRLF", "\r\n"],
  ])("ends a line at %s, as CommonMark does", (_label, eol) => {
    const deep = "- ".repeat(cap + 1) + "hi";
    expect(opensTooManyContainers(`hi${eol}${deep}`)).toBe(true);
    const line = "- ".repeat(cap) + "hi";
    expect(opensTooManyContainers(`${line}${eol}${line}`)).toBe(false);
  });

  it("skips a leading byte-order mark, which the parser drops", () => {
    expect(opensTooManyContainers("\uFEFF" + "- ".repeat(cap + 1) + "hi")).toBe(true);
  });

  it.each([
    ["dashes", "- "],
    ["stars", "* "],
  ])("exempts a divider line of spaced %s, a thematic break", (_label, marker) => {
    expect(opensTooManyContainers(`**bold** above\n${marker.repeat(cap + 8)}\nand below`)).toBe(false);
  });

  it("does not exempt a marker line that mixes dashes and stars, or ends in text", () => {
    expect(opensTooManyContainers("- * ".repeat(cap))).toBe(true);
    expect(opensTooManyContainers("- ".repeat(cap + 1) + "-x")).toBe(true);
  });

  it("counts a marker line inside a fenced code block, deliberately", () => {
    // Over-counting costs this message its formatting. Tracking fences from the
    // source would let a fence the parser closes early hide a marker line.
    expect(opensTooManyContainers("```\n" + "> ".repeat(cap + 1) + "\n```")).toBe(true);
  });

  it("stops counting at the first character that is not a marker", () => {
    expect(opensTooManyContainers("hi " + "- ".repeat(cap + 1))).toBe(false);
  });

  it.each([
    "*bold* and _italic_",
    "- milk\n- eggs\n  - free range",
    "> quoted\n> still quoted",
    "3.14 is close enough",
    "-5 degrees out",
    "1.5x the usual turnout",
    "1234567890. ten digits is not a list marker",
    "",
  ])("leaves ordinary text alone: %j", (content) => {
    expect(opensTooManyContainers(content)).toBe(false);
  });
});
