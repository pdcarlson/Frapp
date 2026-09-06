/**
 * Narrowing helpers for values parsed out of untrusted JSON.
 *
 * Both answer the same question the Discord import paths keep asking of a
 * `JSON.parse` result: is this field usable, or is it absent in one of the
 * several ways a foreign payload can be absent? `null` is the single "no"
 * so a call site can `??` a fallback in one step instead of testing type,
 * nullishness and emptiness separately at every field.
 *
 * The emptiness rule is deliberate and is why `asString` is not just a
 * `typeof` check: Discord sends `""` for fields it has no value for, and every
 * call site depends on that reading as absent. Relaxing it changes two things
 * at once, so audit both before touching it:
 *
 *   - The fallback chains — `asString(a) ?? asString(b) ?? literal`, as in
 *     `resolveAuthorName`. `??` falls through only on null, so a `""` that
 *     reported itself present would stop the chain and win.
 *   - The bare presence tests, which are the majority. `discord-api-message.ts`
 *     decides a message has no text with `asString(message.content) !== null`,
 *     and the rest persist the result directly (`author_external_id`,
 *     `author_avatar_path`, channel and sticker names), so the choice is
 *     between storing `null` and storing `""`.
 *
 * Nothing downstream would catch either: `chat_messages_author_present` is a
 * *presence* check (`sender_id is not null or author_name is not null`), which
 * `""` satisfies, and no column in any migration carries a non-emptiness
 * constraint. The row inserts with a blank author name.
 */

/** A non-empty string, or `null` for anything else — `""` included. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A plain JSON object, or `null`. Arrays are not records and are rejected. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
