/**
 * A route param's one value, or `null` for none: a repeated query key
 * arrives as an array, and an empty one names nothing.
 */
export function firstParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : null;
}
