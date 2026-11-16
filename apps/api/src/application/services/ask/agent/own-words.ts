/**
 * The one sentence a turn of the tool loop may show with no source (Paul,
 * 2026-11-16, `docs/security/ai-prompt-injection.md` C6 and C7 as changed
 * then). Some right answers rest on nothing a tool can return: "hi" back,
 * what Frapp can do, "I don't give out phone numbers", "which Jordan do you
 * mean?". Before, every one of them was replaced by "couldn't find that".
 *
 * What is shown, and only when no citation stood and none was dropped (a
 * dropped quote means the model was stating a fact it could not back):
 * what the model wrote, when the whole of it is short, on as many lines as
 * it takes, or its first sentence when it runs longer. A longer uncited text is the model answering from nothing, and is
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
  // A short reply is shown whole, whatever its shape: a question back with
  // the names it offers on their own lines, a list of what Frapp can do
  // (Paul, 2026-11-16, #5179: the one-line and no-list rules are gone; the
  // length cap and the dropped-quote rule stay).
  if (whole.length <= OWN_WORDS_MAX_SENTENCE) return whole;
  // A longer one is cut to its first sentence, or its first line.
  const firstLine = whole.split('\n')[0].trim();
  const end = SENTENCE_END.exec(firstLine);
  const sentence = (end ? firstLine.slice(0, end.index + 1) : firstLine).trim();
  if (sentence === '' || sentence.length > OWN_WORDS_MAX_SENTENCE) return null;
  return sentence;
}
