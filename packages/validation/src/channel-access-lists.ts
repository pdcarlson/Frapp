/**
 * Who can see and who can post in a channel (#3722): the entries a list holds.
 *
 * A channel or category answers each question with `null` (who can see:
 * everyone in the chapter; who can post: everyone who can see it) or a list
 * of entries. An entry names one kind of thing a member can hold:
 *
 * - `tier:<role_tiers.id>`: every role in that tier.
 * - `role:<roles.id>`: that role.
 *
 * Groups (#4076) add `group:<id>` by adding their kind to
 * {@link CHANNEL_ACCESS_ENTRY_KINDS}, the database's
 * `chat_access_list_valid`, and the member's held entries in the API
 * (`RbacService`). Nothing else branches on the kind.
 *
 * The API owns the decision (`canAccessChannel`); this module is the shared
 * spelling, so the editor never sends an entry the server can't parse.
 */

export const CHANNEL_ACCESS_ENTRY_KINDS = ["tier", "role"] as const;

export type ChannelAccessEntryKind =
  (typeof CHANNEL_ACCESS_ENTRY_KINDS)[number];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** One entry, exactly as stored: a kind, a colon, a lowercase uuid. */
export const CHANNEL_ACCESS_ENTRY_PATTERN = new RegExp(
  `^(${CHANNEL_ACCESS_ENTRY_KINDS.join("|")}):${UUID}$`,
);

/** The most entries one list may hold (a chapter imported from Discord can hold 112 roles). */
export const CHANNEL_ACCESS_LIST_MAX = 500;

export function channelAccessEntry(
  kind: ChannelAccessEntryKind,
  id: string,
): string {
  return `${kind}:${id.toLowerCase()}`;
}

export function parseChannelAccessEntry(
  entry: string,
): { kind: ChannelAccessEntryKind; id: string } | null {
  if (!CHANNEL_ACCESS_ENTRY_PATTERN.test(entry)) return null;
  const colon = entry.indexOf(":");
  return {
    kind: entry.slice(0, colon) as ChannelAccessEntryKind,
    id: entry.slice(colon + 1),
  };
}

/**
 * A list as stored: sorted and without repeats, so two lists that say the
 * same thing compare equal (a channel "matches its category" by equality).
 * `null` stays `null`: it means everyone, not an empty list.
 */
export function normalizeChannelAccessList(
  entries: readonly string[] | null | undefined,
): string[] | null {
  if (entries == null) return null;
  return [...new Set(entries.map((entry) => entry.toLowerCase()))].sort();
}

/** Whether two lists say the same thing (`null` equals only `null`). */
export function sameChannelAccessList(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const left = normalizeChannelAccessList(a);
  const right = normalizeChannelAccessList(b);
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}
