/**
 * Values accepted by validator's `isBoolean` in strict mode (used by `@IsBooleanString()`).
 * Must stay aligned with `validator/lib/isBoolean` so controller coercion matches DTO validation.
 */
const BOOLEAN_STRING_TRUE = new Set(['true', '1']);

/**
 * Parse an optional query string that was validated with `@IsBooleanString()`.
 * Treats `'true'` and `'1'` as true; `'false'` and `'0'` as false.
 */
export function parseBooleanQueryParam(
  value: string | undefined,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return BOOLEAN_STRING_TRUE.has(value);
}
