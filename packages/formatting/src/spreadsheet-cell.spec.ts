import { describe, expect, it } from "vitest";
import { neutralizeFormulaCell, toCsvCell } from "./spreadsheet-cell";

// #3969 / #3976: every spreadsheet export (dashboard CSV and clipboard copy,
// API `format=csv`) makes a member-typed formula cell inert with this rule.
describe("neutralizeFormulaCell", () => {
  it("prefixes a cell a spreadsheet would run as a formula", () => {
    for (const cell of [
      '=HYPERLINK("https://evil.example","Click")',
      "+1+1",
      "-1+1",
      "@SUM(A1:A2)",
      "\t=1+1",
      "\r=1+1",
    ]) {
      expect(neutralizeFormulaCell(cell)).toBe(`'${cell}`);
    }
  });

  it("leaves numbers, currency and ordinary text as they are", () => {
    for (const cell of [
      "-5",
      "+5",
      "-12.50",
      "-$12.00",
      "-$1,200.00",
      "Late arrival",
      "",
      "a=b",
      "🎉 party",
    ]) {
      expect(neutralizeFormulaCell(cell)).toBe(cell);
    }
  });
});

describe("toCsvCell", () => {
  it("makes a formula inert, then quotes it when it needs quoting", () => {
    expect(toCsvCell("=1+1")).toBe("'=1+1");
    expect(toCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsvCell("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("quotes commas, quotes, line breaks and semicolons", () => {
    expect(toCsvCell("a,b")).toBe('"a,b"');
    expect(toCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvCell("one\ntwo")).toBe('"one\ntwo"');
    // A `;`-separator Excel would otherwise open the second half as its own
    // cell, starting with `=` (OWASP: handle the field separators too).
    expect(toCsvCell('Late;=HYPERLINK("x")')).toBe('"Late;=HYPERLINK(""x"")"');
  });

  it("leaves a plain cell, a number and a currency amount bare", () => {
    for (const cell of ["Late arrival", "-5", "-$12.00", ""]) {
      expect(toCsvCell(cell)).toBe(cell);
    }
  });
});
