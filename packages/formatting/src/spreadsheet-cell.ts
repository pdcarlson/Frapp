/**
 * A cell that a spreadsheet would run as a formula, made inert.
 *
 * Excel, Google Sheets and LibreOffice evaluate a text cell that starts with
 * `=`, `+`, `-` or `@` (and Excel also one that starts with a tab or carriage
 * return, which it strips first), so a member-typed description of
 * `=HYPERLINK(...)` in an export would run on the officer's machine (CSV
 * injection, OWASP). A leading apostrophe makes the app read the cell as text.
 *
 * A plain number or a currency amount is left alone: `-5` and `-$12.00` are
 * values, not formulas, and prefixing them would turn every negative points
 * adjustment into text. Applies to CSV and to tab-separated text; an `.xlsx`
 * string cell is typed as text in the file and needs no prefix.
 *
 * The one rule for every spreadsheet export: the dashboard's CSV and
 * clipboard copy (`apps/web/lib/utils.ts`) and the API's `format=csv`
 * reports (`apps/api/src/domain/utils/csv.ts`, #3976).
 */
export function neutralizeFormulaCell(value: string): string {
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (PLAIN_NUMBER.test(value) || CURRENCY_AMOUNT.test(value)) return value;
  return `'${value}`;
}

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
/**
 * A dollar amount as the exports write it (`-$1,200.00`): a value, not a
 * formula. The dashboard's workbook writer also types such a cell as currency.
 */
export const CURRENCY_AMOUNT = /^-?\$\d{1,3}(,?\d{3})*(\.\d+)?$/;
