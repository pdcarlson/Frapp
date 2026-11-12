/**
 * U+FFFC OBJECT REPLACEMENT CHARACTER: the placeholder a rich text view puts
 * where an inline object sits (an image, a sticker, a Genmoji). In plain text
 * there is no object behind it, so every surface draws it as a broken box,
 * which Chrome labels "OBJ" (#4346, a tester's notification list).
 *
 * Nothing in Frapp writes it. It arrives inside text a member typed, most
 * likely from a phone keyboard whose object the text box couldn't hold.
 *
 * Each one becomes a space rather than nothing, so the words either side stay
 * apart: `hi￼@Alice` would otherwise read `hi@Alice`, which the mention
 * tokenizer takes for an email address, and Alice would silently not be
 * mentioned.
 *
 * Where it runs: `ChatService` before a message is saved or edited (every
 * sender, the server's own cards included), the chat push's preview, and the
 * clients wherever they show text stored before that.
 */
const OBJECT_REPLACEMENT = /￼/g;

/** `text` with each object replacement character turned into a space. */
export function withoutObjectReplacement(text: string): string {
  return text.includes("￼") ? text.replace(OBJECT_REPLACEMENT, " ") : text;
}
