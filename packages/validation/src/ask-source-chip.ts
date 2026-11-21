import { formatAiAnswerDate } from "./ai-copy";
import { askSourceMetaLine, type AskSource } from "./ask";

/**
 * What a source chip under an Ask answer reads (#4904, Paul 2026-11-13: a
 * quoted message should say whose it is and when). One rule for web and the
 * phone.
 *
 * A chat source that names its author reads "Ana Ruiz in #general" with the
 * day it was sent beside it, the way Slack's and Discord's search results
 * lead a message with who said it. Every other source, and a chat source
 * from a server that sends no author, reads as its title alone, as before:
 * its kind and date stay in `meta`, the chip's tooltip and accessible name.
 */
export interface AskSourceChip {
  /** The chip's words. */
  name: string;
  /** The day written out, drawn muted after the name; null when not shown. */
  when: string | null;
  /** Kind, place and date, for the tooltip and a screen reader. */
  meta: string;
}

export function askSourceChip(source: AskSource): AskSourceChip {
  const meta = askSourceMetaLine(source);
  const author = source.author?.trim();
  if (!author) return { name: source.title, when: null, meta };
  return {
    name: `${author} in ${source.title}`,
    when: source.date ? formatAiAnswerDate(source.date) : null,
    meta,
  };
}
