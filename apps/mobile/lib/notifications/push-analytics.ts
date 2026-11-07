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
 * - `not_now`: onboarding's "Not now", or the chat home's reminder closed;
 *   no OS prompt was shown.
 */
export type PushPromptAnswer = "allowed" | "denied" | "not_now";

/**
 * Where the member answered: onboarding's notifications step (s03, or chapter
 * setup), s16 Settings' push row, or the chat home's one reminder.
 */
export type PushPromptSurface = "primer" | "settings" | "reminder";

export function pushPromptAnsweredProperties(
  answer: PushPromptAnswer,
  surface: PushPromptSurface,
): { answer: PushPromptAnswer; surface: PushPromptSurface } {
  return { answer, surface };
}
