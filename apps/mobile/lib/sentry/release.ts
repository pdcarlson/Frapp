/**
 * Mobile Sentry `release` / `dist` formatters. Git SHA is never part of either
 * string — it is metadata (`git_sha` tag) only.
 *
 * Omit rather than invent when any piece is missing (Expo Go, web, a
 * simulator without a native build number).
 */

export function formatMobileSentryRelease(parts: {
  bundleId: string | null | undefined;
  version: string | null | undefined;
  nativeBuildNumber: string | null | undefined;
}): string | undefined {
  const bundleId = parts.bundleId?.trim();
  const version = parts.version?.trim();
  const nativeBuildNumber = parts.nativeBuildNumber?.trim();
  if (!bundleId || !version || !nativeBuildNumber) return undefined;
  return `${bundleId}@${version}+${nativeBuildNumber}`;
}

export function formatMobileSentryDist(
  nativeBuildNumber: string | null | undefined,
): string | undefined {
  const dist = nativeBuildNumber?.trim();
  return dist || undefined;
}
