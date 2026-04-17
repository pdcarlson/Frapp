export const BOOLEAN_STRING_QUERY_VALUES = ['true', 'false', '1', '0'] as const;

/** String literals accepted for optional boolean query params (DTO + OpenAPI). */
export type BooleanStringQueryValue =
  (typeof BOOLEAN_STRING_QUERY_VALUES)[number];

const BOOLEAN_STRING_QUERY_SET = new Set<string>(BOOLEAN_STRING_QUERY_VALUES);

const BOOLEAN_STRING_TRUE = new Set<BooleanStringQueryValue>(['true', '1']);

export function isBooleanQueryStringValue(
  value: unknown,
): value is BooleanStringQueryValue {
  return typeof value === 'string' && BOOLEAN_STRING_QUERY_SET.has(value);
}

/**
 * Parse an optional query string that was validated with `@IsBooleanQueryString()`.
 * Treats `'true'` and `'1'` as true; `'false'` and `'0'` as false.
 */
export function parseBooleanQueryParam(
  value: BooleanStringQueryValue | undefined,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return BOOLEAN_STRING_TRUE.has(value);
}
