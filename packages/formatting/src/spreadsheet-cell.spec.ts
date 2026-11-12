import { describe, expect, it } from "vitest";
import { neutralizeFormulaCell } from "./spreadsheet-cell";

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
    for (const cell of ["-5", "+5", "-12.50", "-$12.00", "-$1,200.00", "Late arrival", "", "a=b", "🎉 party"]) {
      expect(neutralizeFormulaCell(cell)).toBe(cell);
    }
  });
});
