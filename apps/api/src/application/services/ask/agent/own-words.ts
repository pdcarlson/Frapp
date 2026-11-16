/**
 * The one sentence a turn of the tool loop may show with no source (Paul,
 * 2026-11-16, `docs/security/ai-prompt-injection.md` C6 and C7 as changed
 * then). Some right answers rest on nothing a tool can return: "hi" back,
 * what Frapp can do, "I don't give out phone numbers", "which Jordan do you
 * mean?". Before, every one of them was replaced by "couldn't find that".
 *
 * What is shown, and only when no citation stood and none was dropped (a
 * dropped quote means the model was stating a fact it could not back):
 * what the model wrote, when the whole of it is one short line, or its
 * first sentence when the line runs longer. A longer uncited text is the model answering from nothing, and is
 * still "couldn't find that". The client marks the sentence as Frapp's own
 * words (`AskAnswer.own_words`).
 */

/** Past this, an uncited text is an answer with no source, not a reply. */
export const OWN_WORDS_MAX_TEXT = 400;

/** The longest sentence shown. */
export const OWN_WORDS_MAX_SENTENCE = 240;

/**
 * The end of a sentence: a stop with a space or the end after it, and not
 * the stop of an initial ("Jordan A. Lee") or a title ("Dr.", "St.").
 */
const SENTENCE_END =
  /(?<!(?:^|[\s@])(?:[A-Z]|Dr|Mr|Mrs|Ms|Jr|Sr|St|Mt|vs|etc|No))[.!?](?=\s|$)/;

export function ownWords(text: string): string | null {
  const whole = text.trim();
  if (whole === '' || whole.length > OWN_WORDS_MAX_TEXT) return null;
  // More than one line, a list item or a heading is the start of an
  // answer, not a reply.
  if (whole.includes('\n') || /^(?:[-*#>]|\d+[.)])\s/.test(whole)) {
    return null;
  }
  // A short reply is shown whole, which keeps a question and the names it
  // offers together; a longer one is cut to its first sentence.
  if (whole.length <= OWN_WORDS_MAX_SENTENCE) return whole;
  const end = SENTENCE_END.exec(whole);
  const sentence = (end ? whole.slice(0, end.index + 1) : whole).trim();
  if (sentence === '' || sentence.length > OWN_WORDS_MAX_SENTENCE) return null;
  return sentence;
}
