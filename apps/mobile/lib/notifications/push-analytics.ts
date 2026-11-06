/**
 * The one client event for the push prompt (`spec/behavior/observability.md`
 * § Push Prompt Telemetry). Named once here, as `search-completed` and the
 * outbox events are, so a typo at a call site can't split it into two names.
 *
 * Client-side because the server never sees the answer: `POST /push-tokens`
 * follows only an "allowed", and it repeats on every launch, so it can't count
 * answers.
 */
export const PUSH_PROMPT_ANSWERED_EVENT = "push-prompt-answered";

/**
 * - `allowed` / `denied`: what the OS prompt returned after "Turn on". A
 *   prompt the OS didn't show (iOS after one answer) reads as `denied`.
 * - `not_now`: the primer card's "Not now"; no OS prompt was shown.
 */
export type PushPromptAnswer = "allowed" | "denied" | "not_now";

/** Where the member answered: the C7 primer card, or s16 Settings' push row. */
export type PushPromptSurface = "primer" | "settings";

export function pushPromptAnsweredProperties(
  answer: PushPromptAnswer,
  surface: PushPromptSurface,
): { answer: PushPromptAnswer; surface: PushPromptSurface } {
  return { answer, surface };
}
