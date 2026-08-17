/**
 * Display-name resolution for the chat surface, shared by web and mobile.
 *
 * Deliberately pure: no `"use client"`, no React, no react-query. Mobile's
 * `lib/chat/channel-list.ts` selectors are plain functions with a plain-node
 * spec, and they must be able to import this rule without dragging a query
 * client into that graph.
 *
 * ## Why names are resolved by id rather than joined onto the message
 *
 * Messages reach a client's cache four ways: the initial REST load, the
 * reconnect backfill, the degraded poll, and a live `postgres_changes` echo of
 * the `chat_messages` row (`packages/chat-core/src/realtime-manager.ts`). Only
 * the first three are REST, and a Postgres replication row cannot carry a join.
 *
 * A join on the message DTO would therefore leave every live-arrived message
 * unnamed — and permanently, not briefly: the live handler advances the
 * last-seen cursor, the server's `since` window is exclusive, and both channel
 * queries set `staleTime: Infinity`, so nothing ever re-fetches that row for the
 * life of the session. Resolving by `sender_id` against a cached roster is the
 * only path-independent option.
 */

/** `users.id` → `display_name`, as served by `GET /v1/members/roster`. */
export type DisplayNameMap = Record<string, string>;

/**
 * The display name for a user id, or `null` when it cannot be resolved.
 *
 * Returns `null` for an empty name as well as a missing one: `display_name` is
 * `NOT NULL DEFAULT ''` in the schema, so `''` is the real "no name set" case
 * and rendering it would produce a blank label rather than a fallback. A deleted
 * account needs no special case — the `anonymize_user` RPC writes
 * `'Deleted User'`, which resolves like any other name.
 *
 * `null` rather than a fallback string so each caller picks its own copy: a
 * message meta line wants `Member 2f4a1c`, a DM row wants `Direct message`.
 */
export function resolveDisplayName(
  names: DisplayNameMap,
  userId: string,
): string | null {
  const name = names[userId];
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A DM channel name the server generated from participant ids
 * (`dm-<uuidA>-<uuidB>`). These are storage keys, never display strings.
 */
export function isServerGeneratedDmName(name: string): boolean {
  return /^dm-[0-9a-f-]{36,}$/i.test(name);
}

/**
 * A group-DM name the server generated from a timestamp
 * (`group-dm-<epoch>`). Only the *fallback* looks like this — `createGroupDm`
 * persists a caller-supplied title when one is given, so a name that fails this
 * test is a real title and must be left alone.
 */
export function isServerGeneratedGroupDmName(name: string): boolean {
  return /^group-dm-\d+$/.test(name);
}

export interface DirectChannelNameInput {
  name: string;
  type: string;
  member_ids: string[];
}

const DM_PLACEHOLDER = "Direct message";
const GROUP_DM_PLACEHOLDER = "Group message";

/** How many participant names a group-DM summary lists before it counts. */
const GROUP_DM_NAMES_SHOWN = 3;

/**
 * What to render as a channel's title.
 *
 * Order matters, and two of the branches exist to protect a specific case:
 *
 * 1. A non-direct channel keeps its name untouched — so a `PUBLIC` channel that
 *    happens to be named `dm-<uuid>-<uuid>` is not rewritten.
 * 2. A direct channel whose name is not a server-generated pattern keeps it —
 *    so a caller-titled group DM ("Exec board") survives.
 * 3. Everything else resolves participants, minus the viewer, and degrades to a
 *    placeholder rather than ever showing a uuid.
 */
export function directChannelDisplayName(
  channel: DirectChannelNameInput,
  viewerId: string | null,
  names: DisplayNameMap,
): string {
  const isDm = channel.type === "DM";
  const isGroupDm = channel.type === "GROUP_DM";
  if (!isDm && !isGroupDm) return channel.name;

  // A blank stored name counts as "no title", not as a title. `CreateGroupDmDto`
  // accepts `name: ""` (optional, no non-empty check), and on web the resolved
  // title is now the row label, the search needle and the sort key at once — so
  // returning "" verbatim would render an unlabeled row that matches no search
  // text and sorts to the top of Direct messages.
  const stored = channel.name.trim();
  const isGenerated =
    stored.length === 0 ||
    (isDm
      ? isServerGeneratedDmName(stored)
      : isServerGeneratedGroupDmName(stored));
  if (!isGenerated) return channel.name;

  const placeholder = isDm ? DM_PLACEHOLDER : GROUP_DM_PLACEHOLDER;
  if (!viewerId) return placeholder;

  const otherIds = channel.member_ids.filter((id) => id !== viewerId);
  const others = otherIds
    .map((id) => resolveDisplayName(names, id))
    .filter((name): name is string => name !== null);

  const [first] = others;
  if (first === undefined) return placeholder;
  if (isDm) return first;

  const shown = others.slice(0, GROUP_DM_NAMES_SHOWN).join(", ");
  // Counted against every other participant, not just the named ones. Counting
  // resolved names would understate the thread — a twelve-person group DM where
  // only four members have set a name would read as a four-person conversation,
  // and two different groups sharing three named members would render the same
  // title.
  const remaining = otherIds.length - GROUP_DM_NAMES_SHOWN;
  return remaining > 0 ? `${shown} +${remaining}` : shown;
}
