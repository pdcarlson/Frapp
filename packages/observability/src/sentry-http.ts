/** Shared Sentry/PostHog HTTP helpers. No identify / group / setUser. */

/**
 * A header's value when it is a non-empty string, read under `name`, or under
 * its lowercase form when `name` holds nothing. Anything else (no headers
 * object, a missing header, an empty string, an array or other non-string
 * value) is `undefined`.
 */
export function headerValue(
  headers: unknown,
  name: string,
): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const record = headers as Record<string, unknown>;
  const direct = record[name] ?? record[name.toLowerCase()];
  return typeof direct === "string" && direct.length > 0 ? direct : undefined;
}

/**
 * The `status_class` every surface writes on PostHog: the
 * `sentry-error-correlated` marker (API, web, mobile, landing) and the API's
 * sanitized request, error and `security_event` logs.
 *
 * An integer from 100 to 599 buckets by its hundreds digit: `"1xx"`, `"2xx"`,
 * `"3xx"`, `"4xx"` or `"5xx"`. Anything else is `undefined`, so the caller
 * omits the property: a non-number, `NaN`, `±Infinity`, a non-integer, or an
 * integer below 100 or from 600 up. An absent class is honest; a guessed one
 * (junk reported as `"5xx"`) is an error that never happened.
 */
export function httpStatusClass(status: unknown): string | undefined {
  if (typeof status !== "number" || !Number.isInteger(status)) return undefined;
  if (status < 100 || status >= 600) return undefined;
  return `${Math.floor(status / 100)}xx`;
}
