import { firstPartyTracePropagationTargets } from "@repo/observability";

/**
 * Web Sentry trace targets. Next inlines `NEXT_PUBLIC_API_URL` here.
 */

export function webTracePropagationTargets(
  apiUrl: string | undefined = process.env.NEXT_PUBLIC_API_URL,
): string[] {
  return firstPartyTracePropagationTargets(apiUrl);
}
