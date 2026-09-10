import { firstPartyTracePropagationTargets } from "@repo/observability";

/**
 * Mobile Sentry trace targets. Expo inlines `EXPO_PUBLIC_API_URL` here.
 */

export function mobileTracePropagationTargets(
  apiUrl?: string,
): string[] {
  return firstPartyTracePropagationTargets(
    apiUrl ?? process.env.EXPO_PUBLIC_API_URL,
  );
}
