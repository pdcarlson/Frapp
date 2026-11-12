import { toCsvCell } from '@repo/formatting';

/**
 * Converts an array of objects to a CSV string per RFC 4180.
 * Each text cell goes through `toCsvCell` (`@repo/formatting`), the same cell
 * writer as the dashboard's export: a cell a spreadsheet would run as a formula
 * is made inert, then a cell holding a comma, quote, semicolon or line break is
 * quoted (CSV injection, #3976). A number, boolean or bigint is written as is:
 * it is a value, never a formula.
 */
export function toCSV<T extends Record<string, any>>(
  rows: T[],
  columns: { key: string; header: string }[],
): string {
  const stringifyPrimitive = (
    value: string | number | boolean | bigint,
  ): string => String(value);

  const stringifyArrayItem = (item: unknown): string => {
    if (item === null || item === undefined) {
      return '';
    }
    if (typeof item === 'object') {
      return JSON.stringify(item);
    }
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      typeof item === 'bigint'
    ) {
      return stringifyPrimitive(item);
    }
    return '';
  };

  // Text goes through the shared cell writer: formula-shaped text made inert,
  // then quoted when it holds a comma, quote, semicolon or line break. A number,
  // boolean or bigint is a value, never a formula, and holds none of those
  // characters, so it is written as is (`-1e-7` stays a number).
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return toCsvCell(
        Array.isArray(value)
          ? value.map(stringifyArrayItem).join(', ')
          : JSON.stringify(value),
      );
    }
    if (typeof value === 'string') {
      return toCsvCell(value);
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return stringifyPrimitive(value);
    }
    return '';
  };

  const headerRow = columns.map((c) => escape(c.header)).join(',');
  const dataRows = rows.map((row) =>
    columns.map((c) => escape(row[c.key])).join(','),
  );

  return [headerRow, ...dataRows].join('\r\n');
}
