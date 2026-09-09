/** HTTP status class for content-free PostHog envelopes (`2xx` / `4xx` / `5xx`). */
export function httpStatusClass(status: number): string {
  if (!Number.isFinite(status)) return '5xx';
  const bucket = Math.floor(status / 100);
  if (bucket >= 1 && bucket <= 5) return `${bucket}xx`;
  return '5xx';
}
