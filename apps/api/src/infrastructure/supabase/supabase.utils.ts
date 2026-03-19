export function escapeFilterValue(value: string): string {
  // PostgREST string quoting: surround with double quotes and escape internal
  // backslashes and double quotes.
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}
