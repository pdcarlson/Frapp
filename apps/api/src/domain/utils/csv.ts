/**
 * Converts an array of objects to a CSV string per RFC 4180.
 * Properly escapes values containing commas, quotes, or newlines.
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

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '';
    }
    let str: string;
    if (typeof value === 'object') {
      str = Array.isArray(value)
        ? value.map(stringifyArrayItem).join(', ')
        : JSON.stringify(value);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      str = stringifyPrimitive(value);
    } else {
      str = '';
    }
    if (
      str.includes(',') ||
      str.includes('"') ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
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
