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
 * reports (`apps/api/src/domain/utils/csv.ts`, #3976), both through
 * {@link toCsvCell}; the clipboard copy calls it directly.
 */
export function neutralizeFormulaCell(value: string): string {
  if (!/^[=+\-@\t\r]/.test(value)) return value;
  if (PLAIN_NUMBER.test(value) || CURRENCY_AMOUNT.test(value)) return value;
  return `'${value}`;
}

/**
 * One CSV cell, ready to join with commas: formula-shaped text made inert
 * ({@link neutralizeFormulaCell}), then quoted per RFC 4180 when it holds a
 * comma, a double quote or a line break, with each `"` doubled.
 *
 * A semicolon is quoted too. Excel in a locale whose list separator is `;`
 * (much of Europe) splits a `.csv` on semicolons, so an unquoted
 * `Late;=HYPERLINK(...)` would open as two cells, the second a formula the
 * leading-character check never saw. OWASP's CSV-injection guidance names the
 * field separators for this reason. Quoting a field is always legal RFC 4180,
 * so a parser reads the same value either way.
 *
 * The one cell writer for both CSV exports: the dashboard's `rowsToCsv` and
 * the API's `toCSV` (#3976).
 */
export function toCsvCell(value: string): string {
  const cell = neutralizeFormulaCell(value);
  return /[",;\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;
/**
 * A dollar amount as the exports write it (`-$1,200.00`): a value, not a
 * formula. The dashboard's workbook writer also types such a cell as currency.
 */
export const CURRENCY_AMOUNT = /^-?\$\d{1,3}(,?\d{3})*(\.\d+)?$/;
