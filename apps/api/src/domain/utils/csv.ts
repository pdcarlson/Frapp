/**
 * Converts an array of objects to a CSV string per RFC 4180.
 * Properly escapes values containing commas, quotes, or newlines.
 */
export function toCSV(
  rows: Record<string, unknown>[],
  columns: { key: string; header: string }[],
): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    let str: string;
    if (typeof value === 'object') {
      str = Array.isArray(value) ? value.join(', ') : JSON.stringify(value);
    } else {
      str = String(value);
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const headerRow = columns.map((c) => escape(c.header)).join(',');
  const dataRows = rows.map((row) =>
    columns.map((c) => escape(row[c.key])).join(','),
  );

  return [headerRow, ...dataRows].join('\r\n');
}
