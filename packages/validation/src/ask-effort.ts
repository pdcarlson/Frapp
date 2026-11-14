import type { AskEffort } from "./ask";

/**
 * "Think harder" under an Ask answer (#4904, `spec/behavior/ai.md` § Ask
 * Frapp): the same question asked again in the answer's place with more
 * effort (`effort: "more"`, {@link AskEffort}). The words both clients show.
 */
export const ASK_EFFORT_COPY = {
  /** The control's name; it is drawn as an icon. */
  action: "Think harder",
} as const;

/**
 * Whether an answer offers Think harder: one the server kept a trace of (so
 * it came through the tool loop, which is what reads the effort), that said
 * something or found nothing, and was not already the harder answer.
 */
export function askOffersThinkHarder(
  answer: { status: string; ask_id?: string | null },
  effort: AskEffort | null | undefined,
): boolean {
  return (
    !!answer.ask_id &&
    effort !== "more" &&
    (answer.status === "answered" || answer.status === "not_found")
  );
}
