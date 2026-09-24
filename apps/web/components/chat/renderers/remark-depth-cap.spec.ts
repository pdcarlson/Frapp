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
