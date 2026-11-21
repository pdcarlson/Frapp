/**
 * How text a member wrote is put on one line of a source: a tool's result,
 * and the source that says who is asking (`ask-tool.ts` has the rules).
 */

const FREE_TEXT_LIMIT = 300;

/** One line of member-written text: no line breaks, cut to a sane length. */
export function oneLine(text: string | null | undefined): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > FREE_TEXT_LIMIT
    ? `${flat.slice(0, FREE_TEXT_LIMIT).trimEnd()}...`
    : flat;
}

/**
 * A member's name inside a `name: fact` line. Members choose their own
 * display name, so the characters that separate a name from its fact are
 * taken out: "Jordan Lee: Treasurer" as a name would otherwise read as a
 * role the roster never gave.
 */
export function nameInLine(name: string | null | undefined): string {
  return oneLine((name ?? '').replace(/[:;.,|()[\]]+/g, ' '));
}
