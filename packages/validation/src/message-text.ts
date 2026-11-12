/**
 * U+FFFC OBJECT REPLACEMENT CHARACTER: the placeholder a rich text view puts
 * where an inline object sits (an image, a sticker, a Genmoji). In plain text
 * there is no object behind it, so every surface draws it as a broken box,
 * which Chrome labels "OBJ" (#4346, a tester's notification list).
 *
 * Nothing in Frapp writes it. It arrives inside a message's text from a phone
 * keyboard whose object the text box couldn't hold, so it is removed where
 * text comes in (the chat send and edit DTOs) and where text already stored
 * is shown (a notification's preview), never left for one surface to hide.
 */
const OBJECT_REPLACEMENT = /￼/g;

/** `text` without any object replacement character. */
export function stripObjectReplacement(text: string): string {
  return text.includes("￼") ? text.replace(OBJECT_REPLACEMENT, "") : text;
}
