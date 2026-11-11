import { channelAccessEntry } from '@repo/validation';
import { SystemRoleKeys } from '../constants/permissions';
import type { ChannelType } from '../entities/chat.entity';
import type { Role } from '../entities/role.entity';

/**
 * The chat channel-access predicate, shared by every chat and search path in
 * the API: cold reads, the hot-path send and react controllers
 * (`ChatService.sendMessage`, `ChatReactionService.recordMessageAction`), and
 * search. Pure: no I/O, no framework imports. Callers perform their own TRUSTED
 * database lookups (channel record, the caller's chapter membership, and, when
 * a list or the Alumni rule can decide, what the caller holds) and feed them
 * in here. Centralizing the rule prevents the layers from drifting apart,
 * which is how cross-tenant authorization holes appear. Its database twin is
 * `can_read_chat_channel` (migration 20261111230000).
 *
 * Moved out of `@repo/validation` (#3268). The lists' entry spelling is still
 * shared from there (`channel-access-lists.ts`), so the editor and this
 * predicate agree on what an entry is.
 */

/** The trusted channel fields the access decision depends on. */
export interface ChannelAccessRecord {
  /**
   * A {@link ChannelType}, widened to `string` because it is read off a
   * stored row: an unknown value is denied, never trusted.
   */
  type: string;
  member_ids: string[] | null;
  /**
   * Who can see a PUBLIC or ROLE_GATED channel (#3722): `null` is everyone in
   * the chapter, a list admits members holding any entry in it
   * (`tier:<id>`, `role:<id>`). An empty list admits nobody but `*`.
   * Ignored for PRIVATE / DM / GROUP_DM, which `member_ids` decides.
   */
  who_can_see: string[] | null;
  /**
   * Who can post there: `null` is everyone who can see it, a list admits
   * those of them holding an entry in it. Only consulted for a write.
   */
  who_can_post: string[] | null;
  /**
   * Set once a GROUP_DM's membership drops to <= 1 via the leave endpoint
   * (#348). Only consulted for a write operation, where it denies
   * unconditionally: no permission clears it, since there is no "unarchive"
   * flow. Safe to omit for read checks: an archived channel stays directly
   * readable by whoever is still in `member_ids`.
   */
  archived_at?: string | null;
  /**
   * The chapter's audit-log channel (`#chapter-audit`, #3909). System-write
   * only: every member write is denied, with no permission that clears it,
   * because only the server's audit mirror posts there. Safe to omit for read
   * checks.
   */
  is_audit_log?: boolean | null;
}

/**
 * Operation the predicate is being consulted for. Defaults to "read".
 *
 * - `read`: see the channel.
 * - `post`: write in the timeline (who can post decides).
 * - `vote`: take part in something already readable (a poll). Who can post
 *   decides it as for `post`, but the Alumni rule does not apply: alumni are
 *   restricted from posting, not from a poll they can read.
 * - `thread`: write inside a message thread (#3785). Authored content, so
 *   archive, the audit log and the Alumni rule apply as for `post`, but not
 *   who can post: any member who can read an announcement may thread under it
 *   (Winston, 2026-11-10; spec/behavior/chat/README.md § Message threads).
 */
export type ChannelOperation = 'read' | 'post' | 'vote' | 'thread';

/**
 * What a member holds that a list can name, resolved from a TRUSTED read of
 * their roles in the channel's chapter (`RbacService.getChannelAccessHolder`,
 * or `getChapterMemberAccess` for a whole chapter).
 */
export interface ChannelAccessHolder {
  /** `role:<id>` for each role they hold here and `tier:<id>` for its tier. */
  entries: ReadonlySet<string>;
  /**
   * Holds `*` (the President). Passes every list, so a chapter can't lock
   * itself out, and the Alumni rule.
   */
  wildcard: boolean;
  /**
   * The entries that come from the Alumni role (`role:<id>`, and its tier's
   * when it sits in one) when they hold it, else `null`. Holding the role is
   * what restricts, whatever else they hold (`spec/behavior/alumni.md`).
   */
  alumniEntries: ReadonlySet<string> | null;
}

/** A holder with nothing: decides every list as an empty role set would. */
export const EMPTY_ACCESS_HOLDER: ChannelAccessHolder = {
  entries: new Set(),
  wildcard: false,
  alumniEntries: null,
};

/**
 * What a member holds, from the roles they hold in one chapter. The caller
 * passes only roles already re-scoped to that chapter (a member's `role_ids`
 * is not foreign-keyed, so a stale or foreign id must contribute nothing).
 *
 * `*` comes from a role's own `permissions`; custom roles never carry it
 * (`flattenPermissionSets`), so they are not read. The Alumni role is the one
 * with `system_key` `ALUMNI`, as `RbacService.getAlumniRoleId` resolves it.
 */
export function accessHolderFromRoles(
  roles: readonly Pick<Role, 'id' | 'tier_id' | 'permissions' | 'system_key'>[],
): ChannelAccessHolder {
  const entries = new Set<string>();
  let wildcard = false;
  let alumniEntries: Set<string> | null = null;
  for (const role of roles) {
    const held = [channelAccessEntry('role', role.id)];
    if (role.tier_id) held.push(channelAccessEntry('tier', role.tier_id));
    for (const entry of held) entries.add(entry);
    if ((role.permissions ?? []).includes('*')) wildcard = true;
    if (role.system_key === SystemRoleKeys.ALUMNI) {
      alumniEntries ??= new Set();
      for (const entry of held) alumniEntries.add(entry);
    }
  }
  return { entries, wildcard, alumniEntries };
}

export interface ChannelAccessInput {
  channel: ChannelAccessRecord;
  /** App-level user id, resolved from the session, never the client payload. */
  userId: string;
  /** Whether the caller is an active member of the chapter that owns the channel. */
  isChapterMember: boolean;
  /**
   * What the caller holds in that chapter. Only read where a list or the
   * Alumni rule can decide ({@link needsAccessHolder}); pass
   * {@link EMPTY_ACCESS_HOLDER} elsewhere.
   */
  holder: ChannelAccessHolder;
  /** What the caller is trying to do. `"read"` (default) checks visibility. */
  operation?: ChannelOperation;
}

const DIRECT_TYPES: ReadonlySet<string> = new Set<ChannelType>([
  'DM',
  'GROUP_DM',
]);
const MEMBER_LIST_TYPES: ReadonlySet<string> = new Set<ChannelType>([
  'PRIVATE',
  'DM',
  'GROUP_DM',
]);
const LIST_TYPES: ReadonlySet<string> = new Set<ChannelType>([
  'PUBLIC',
  'ROLE_GATED',
]);

/** Whether `list` admits `holder`: `null` admits everyone, `*` passes any list. */
function listAdmits(
  list: readonly string[] | null,
  holder: ChannelAccessHolder,
): boolean {
  if (list === null) return true;
  if (holder.wildcard) return true;
  return list.some((entry) => holder.entries.has(entry));
}

/**
 * Whether someone holding the Alumni role may author content in `channel`
 * (`spec/behavior/alumni.md`). Alumni read everywhere they can see, but write
 * only in direct conversations and in a channel that names the Alumni role
 * (or its tier): in who can post, or in who can see when anyone who can see
 * may post. "Everyone" names nobody, so `#general` stays closed to them, and
 * a seeded `#alumni`, whose who can see lists the Alumni role, is open.
 */
export function isAlumniPostableChannel(
  channel: ChannelAccessRecord,
  alumniEntries: ReadonlySet<string>,
): boolean {
  if (DIRECT_TYPES.has(channel.type)) return true;
  if (!LIST_TYPES.has(channel.type)) return false;
  const named = channel.who_can_post ?? channel.who_can_see;
  if (named === null) return false;
  return named.some((entry) => alumniEntries.has(entry));
}

/**
 * Whether {@link canAccessChannel} can read the holder for this channel and
 * operation, so callers skip the role lookup when it can't change the answer:
 * a read of a channel everyone sees, anything in a DM or group DM, a read of a
 * private channel.
 */
export function needsAccessHolder(
  channel: Pick<ChannelAccessRecord, 'type' | 'who_can_see' | 'who_can_post'>,
  operation: ChannelOperation = 'read',
): boolean {
  if (DIRECT_TYPES.has(channel.type)) return false;
  if (channel.type === 'PRIVATE') {
    // `post` and `thread`: the Alumni rule; `vote`: a read-only private
    // channel's who-can-post list from before #3722.
    return (
      operation === 'post' ||
      operation === 'thread' ||
      (operation === 'vote' && channel.who_can_post !== null)
    );
  }
  if (!LIST_TYPES.has(channel.type)) return false;
  if (channel.who_can_see !== null) return true;
  switch (operation) {
    case 'read':
      return false;
    case 'vote':
      return channel.who_can_post !== null;
    default:
      // `post` and `thread`: the Alumni rule can decide.
      return true;
  }
}

/**
 * Whether a channel takes message threads (#3785). Channels and group DMs do,
 * read-only ones included; a 1:1 DM does not in slice 1, and the audit log
 * (system-write only) never does. `canAccessChannel` with `operation:
 * 'thread'` still decides whether this caller may write in one.
 */
export function channelAllowsThreads(
  channel: Pick<ChannelAccessRecord, 'type' | 'is_audit_log'>,
): boolean {
  return channel.type !== 'DM' && channel.is_audit_log !== true;
}

/**
 * Decide whether `userId` may access (read / participate in) `channel`.
 *
 * - Non-members of the owning chapter are always denied.
 * - PRIVATE / DM / GROUP_DM: the user must be in the explicit `member_ids`
 *   list (no `*` bypass: no officer opens a member's private thread).
 * - PUBLIC / ROLE_GATED: who can see decides. `null` admits every member; a
 *   list admits a holder of any entry in it, or `*`. An empty list admits
 *   only `*`.
 * - Unknown channel type: denied (guarded default, never falls open).
 *
 * A write (`post`, `vote`, `thread`) must also pass the read, and is refused
 * in an archived channel and in the audit log whatever the caller holds.
 * Then:
 *
 * - The Alumni rule, for `post` and `thread`: a holder of the Alumni role
 *   writes only where {@link isAlumniPostableChannel} says, unless they hold
 *   `*`. `vote` is exempt: a poll they can read is participation.
 * - `thread` stops there: any reader may write in a message thread.
 * - `post` and `vote`: who can post decides, as who can see does for a read.
 *   A quote reply is a post, so whoever may post may quote (#3722).
 *   A private channel has a who-can-post list only if it was made read-only
 *   before #3722.
 */
export function canAccessChannel(input: ChannelAccessInput): boolean {
  const { channel, userId, isChapterMember, holder } = input;
  const operation: ChannelOperation = input.operation ?? 'read';

  if (!isChapterMember) return false;

  let canRead: boolean;
  if (MEMBER_LIST_TYPES.has(channel.type)) {
    canRead = (channel.member_ids ?? []).includes(userId);
  } else if (LIST_TYPES.has(channel.type)) {
    canRead = listAdmits(channel.who_can_see, holder);
  } else {
    canRead = false;
  }

  if (!canRead) return false;
  if (operation === 'read') return true;

  // An archived channel (#348) is frozen: no further writes from anyone.
  // There is no "unarchive" flow, so there is no override either.
  if (channel.archived_at) return false;

  // The audit log (#3909) is system-write only. The audit mirror inserts its
  // rows directly and never comes through here, so refusing every caller,
  // the President's `*` included, leaves exactly the server writing in it.
  if (channel.is_audit_log) return false;

  if (
    (operation === 'post' || operation === 'thread') &&
    holder.alumniEntries !== null &&
    !holder.wildcard &&
    !isAlumniPostableChannel(channel, holder.alumniEntries)
  ) {
    return false;
  }

  // A thread reply is open to every reader. The timeline of an announcement
  // stays with who can post; its threads do not.
  if (operation === 'thread') return true;

  // A DM or group DM has no who-can-post list. A private channel does only
  // when someone made it read-only before #3722 (migration 20261111230000).
  if (MEMBER_LIST_TYPES.has(channel.type) && channel.type !== 'PRIVATE') {
    return true;
  }
  return listAdmits(channel.who_can_post, holder);
}
