/**
 * What Ask opens on before the first turn (#4904; Paul, 2026-11-17): the
 * crest, the day and a greeting, and on a member's first open one exchange
 * that has already happened, "What can you do?" and Frapp's answer. Paul:
 * "You don't have to write it there at the top every single time. That's a
 * big pet peeve of mine." Until then every open began with a title and a
 * paragraph about where answers come from (`ASK_COPY.empty_*`, gone).
 *
 * Both clients draw these words; nothing here is fetched or sent. The
 * starter is our copy, never a model's, so it needs no AI consent and is
 * never sent as an earlier turn (`spec/behavior/ai.md` § What Ask opens with).
 */

/** A member's first name: the first word of their display name. */
export function askFirstName(displayName: string | null | undefined): string | null {
  const first = displayName?.trim().split(/\s+/)[0] ?? "";
  return first.length > 0 ? first : null;
}

/**
 * "Good morning, Marcus." by the device's clock: morning before noon,
 * afternoon before 5pm, evening after. Without a name, "Good evening."
 */
export function askGreeting(
  now: Date,
  displayName: string | null | undefined,
): string {
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const name = askFirstName(displayName);
  return name ? `Good ${part}, ${name}.` : `Good ${part}.`;
}

/** The day over the greeting, written out: "Monday, November 17". */
export function askDayLine(now: Date): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** The words of the first-open exchange. */
export const ASK_STARTER = {
  /** Over the exchange, beside the crest: "Hey Marcus, I'm Frapp." */
  hello: (displayName: string | null | undefined): string => {
    const name = askFirstName(displayName);
    return name ? `Hey ${name}, I'm Frapp.` : "Hey, I'm Frapp.";
  },
  /** Drawn as the member's own bubble, already sent. */
  question: "What can you do?",
  /** Frapp's answer, for every member who has Ask. */
  answer:
    "I answer questions about your chapter from its documents, minutes, events and records, and every answer links to where it came from.",
  /** Added for a member Frapp can act for. */
  answer_act:
    "Tell me what needs doing too, like “make a task for me due Friday”. You'll see exactly what would change, and nothing does until you confirm.",
} as const;
