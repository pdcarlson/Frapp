export function escapeFilterValue(value: string): string {
  // PostgREST string quoting: surround with double quotes and escape internal double quotes by doubling them.
  return `"${value.replace(/"/g, '""')}"`;
}
