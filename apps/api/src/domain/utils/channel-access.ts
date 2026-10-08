import { ALUMNI_CHANNEL_PERMISSION } from '@repo/validation';

/**
 * The chat channel-access predicate, shared by every chat and search path in
 * the API: cold reads, the hot-path send and react controllers
 * (`ChatService.sendMessage`, `ChatService.recordMessageAction`), and search.
 * Pure: no I/O, no framework imports. Callers perform their own TRUSTED
 * database lookups (channel record, the caller's chapter membership, and, only
 * for ROLE_GATED channels, the caller's effective permissions) and feed them
 * in here. Centralizing the rule prevents the layers from drifting apart,
 * which is how cross-tenant authorization holes appear.
 *
 * Moved out of `@repo/validation` (#3268). It lived there, inline in
 * `index.ts`, so the pre-ADR-11 Supabase Edge Functions `chat-send` and
 * `chat-react` could import it through a Deno import map (#416). They are
 * gone and no client imports it, so the rule is the API's alone.
 */

export type ChatChannelType =
  'PUBLIC' | 'PRIVATE' | 'ROLE_GATED' | 'DM' | 'GROUP_DM';

/** The trusted channel fields the access decision depends on. */
export interface ChannelAccessRecord {
  /**
   * A {@link ChatChannelType}, widened to `string` because it is read off a
   * stored row: an unknown value is denied, never trusted.
   */
  type: string;
  member_ids: string[] | null;
  required_permissions: string[] | null;
  /**
   * Whether the channel rejects member writes (e.g. `#announcements` and
   * `#chapter-audit`). Only consulted when `operation === "post"`; safe to
   * omit (treated as `false`) for read checks. (Chunk 05 / ADR-07.)
   */
  is_read_only?: boolean | null;
  /**
   * Set once a GROUP_DM's membership drops to <= 1 via the leave endpoint
   * (#348). Only consulted for a write operation, where it denies
   * unconditionally — unlike `is_read_only`, no permission clears it, since
   * there is no "unarchive" flow. Safe to omit for read checks: an archived
   * channel stays directly readable by whoever is still in `member_ids`.
   */
  archived_at?: string | null;
}

/**
 * Operation the predicate is being consulted for. Defaults to "read".
 *
 * `"vote"` is a write that does not author channel content (poll votes). It
 * clears the same read-only / `announcements:post` gate as `"post"`, but is
 * deliberately **not** subject to the Alumni lifecycle rule — alumni are
 * restricted from posting, not from participating in a poll they can read.
 */
export type ChannelOperation = 'read' | 'post' | 'vote';

/** Permission key that grants posting into a read-only channel (e.g. `#announcements`). */
export const ANNOUNCEMENTS_POST_PERMISSION = 'announcements:post';

export interface ChannelAccessInput {
  channel: ChannelAccessRecord;
  /** App-level user id, resolved from the session — never the client payload. */
  userId: string;
  /** Whether the caller is an active member of the chapter that owns the channel. */
  isChapterMember: boolean;
  /**
   * The caller's effective permission strings in that chapter. Consulted for
   * ROLE_GATED channels and for write checks against read-only channels.
   * `"*"` (wildcard) grants access.
   */
  permissions: string[];
  /**
   * What the caller is trying to do. `"read"` (default) checks visibility;
   * `"post"` additionally enforces the read-only / announcements:post gate.
   */
  operation?: ChannelOperation;
  /**
   * Whether the caller holds the chapter's Alumni role. Alumni are read-mostly:
   * they keep full read access but may only post in direct conversations and in
   * ROLE_GATED channels that require `alumni:post` (the seeded `#alumni`). Only
   * consulted when `operation === "post"`; omit (or `false`) for active members.
   */
  isAlumni?: boolean;
}

/**
 * Channel types an Alumni-role member may post into. Alumni keep read access
 * everywhere they can see, but writing is limited to the alumni channel
 * (ROLE_GATED) and direct conversations. See `spec/behavior/alumni.md`.
 */
// Typed on construction so a typo is a compile error, but exposed as a
// ReadonlySet<string> because `ChannelAccessRecord.type` is widened to string.
//
// DM / GROUP_DM are unconditional: a direct conversation is alumni-writable by
// construction. ROLE_GATED is deliberately NOT in this set — being role-gated
// says nothing about being *for* alumni, and treating the two as the same thing
// made every ROLE_GATED channel (e.g. a chapter's `#exec-board`) alumni-postable
// (FRA-321). A ROLE_GATED channel is alumni-writable only when it explicitly
// requires `ALUMNI_CHANNEL_PERMISSION` (`@repo/validation`); see
// `isAlumniPostableChannel`.
export const ALUMNI_POSTABLE_CHANNEL_TYPES: ReadonlySet<string> =
  new Set<ChatChannelType>(['DM', 'GROUP_DM']);

/**
 * Whether an Alumni-role member may author content in `channel`.
 *
 * Exported so the API can skip the Alumni role lookup on channels where the
 * rule cannot apply, using the same predicate the gate itself uses.
 */
export function isAlumniPostableChannel(channel: ChannelAccessRecord): boolean {
  if (ALUMNI_POSTABLE_CHANNEL_TYPES.has(channel.type)) return true;
  if (channel.type !== 'ROLE_GATED') return false;
  return (channel.required_permissions ?? []).includes(
    ALUMNI_CHANNEL_PERMISSION,
  );
}

/**
 * Whether `channel` accepts in-thread replies.
 *
 * Read-only channels (`#announcements`, `#chapter-audit`) are broadcast
 * surfaces. Per `spec/behavior/chat/README.md` § Announcements: "Announcement
 * messages cannot be replied to in-thread." A reply would turn a one-way
 * broadcast into a conversation the channel's whole point is to not have —
 * note the rationale is the one-way model, *not* hidden nesting: replies here
 * are Discord-style reply-with-quote rendered in the main timeline (§ Reply
 * threads), so nothing is ever tucked out of sight.
 *
 * Two deliberate properties:
 *
 * - **Keyed off `is_read_only`, not the channel name.** The same flag already
 *   decides *who* may post (`canAccessChannel`), so one flag governs broadcast
 *   semantics end to end. A name match would silently stop enforcing the moment
 *   a chapter renamed its announcements channel, and would miss `#chapter-audit`
 *   and any chapter-created read-only channel.
 * - **Unconditional on permissions.** `canAccessChannel` decides who may author a
 *   top-level announcement; this decides that no member threads one — holders
 *   of `announcements:post` and of the `"*"` wildcard included. The rule is a
 *   property of the channel, not of the caller, so this deliberately takes no
 *   permissions argument. Do not add one: a `"*"` escape hatch here reopens
 *   exactly the hole the predicate exists to close.
 *
 * It gates what a member *sends* (`ChatService.sendMessage` is the caller), not
 * what is stored: the poll-expiry notice and the Discord archive importer both
 * write replies into read-only channels server-side (the spec section above).
 * So do not read a stored row's `reply_to_id` in a read-only channel as a
 * violation, or hide its quote: the expiry notice names its poll only there.
 *
 * Takes a whole `ChannelAccessRecord` rather than just the field it reads, for
 * the same reason `isAlumniPostableChannel` does: a `Pick<…, "is_read_only">`
 * is an all-optional type, so a caller handing over a projection that never
 * selected the column would type-check and read as replyable. Requiring the
 * full record makes the caller prove it loaded a real channel — this predicate
 * must fail closed, and an omitted field is the one way it could fail open.
 */
export function allowsInThreadReplies(channel: ChannelAccessRecord): boolean {
  return !channel.is_read_only;
}

/**
 * Decide whether `userId` may access (read / participate in) `channel`.
 *
 * - Non-members of the owning chapter are always denied.
 * - PUBLIC: any chapter member.
 * - PRIVATE / DM / GROUP_DM: the user must be in the explicit `member_ids` list.
 * - ROLE_GATED: the user must hold `"*"` or one of `required_permissions`. An
 *   empty/absent requirement list is denied — a role-gated channel that gates on
 *   nothing is a misconfiguration, not a public channel (FRA-321).
 * - Unknown channel type: denied (guarded default — never falls open).
 *
 * When `operation` is a write (`"post"` or `"vote"`), the read check above must
 * pass AND the channel must either not be read-only, or the caller must hold
 * `"*"` or `"announcements:post"`. Existing callers default to `"read"`, so the
 * predicate stays backward-compatible.
 *
 * When `operation === "post"` and `isAlumni` is set, the caller is additionally
 * limited to direct conversations and ROLE_GATED channels that explicitly
 * require `alumni:post` — alumni read everywhere they can see but do not author
 * content in operational channels.
 * `"*"` (President) still bypasses, so a chapter cannot lock itself out.
 * `"vote"` is exempt: participating in a poll is not posting.
 */
export function canAccessChannel(input: ChannelAccessInput): boolean {
  const { channel, userId, isChapterMember, permissions } = input;
  const operation: ChannelOperation = input.operation ?? 'read';

  if (!isChapterMember) return false;

  const canRead = (() => {
    switch (channel.type) {
      case 'PUBLIC':
        return true;

      case 'PRIVATE':
      case 'DM':
      case 'GROUP_DM':
        return (channel.member_ids ?? []).includes(userId);

      case 'ROLE_GATED': {
        if (permissions.includes('*')) return true;
        const required = channel.required_permissions ?? [];
        // An empty requirement list is a misconfiguration, not an invitation:
        // it used to mean "any chapter member", which made a ROLE_GATED channel
        // functionally PUBLIC and silently un-gated (FRA-321). Deny instead, and
        // keep the field populated at both write points (channel create/update
        // reject an empty list; the seeder always persists one).
        if (required.length === 0) return false;
        return required.some((permission) => permissions.includes(permission));
      }

      default:
        return false;
    }
  })();

  if (!canRead) return false;
  if (operation === 'read') return true;

  // An archived channel (#348) is frozen: no further writes from anyone,
  // regardless of permissions. Checked before the President wildcard below —
  // unlike the read-only / announcements:post gate, there is no override,
  // because there is no "unarchive" flow to make an override meaningful.
  if (channel.archived_at) return false;

  const isPresident = permissions.includes('*');

  // Alumni lifecycle: read-mostly. They may only write in the alumni channel
  // and direct conversations, never in operational PUBLIC/PRIVATE channels.
  // Only authored content ("post") is restricted — "vote" is participation in
  // something they can already read, so it stays open.
  if (
    operation === 'post' &&
    input.isAlumni &&
    !isPresident &&
    !isAlumniPostableChannel(channel)
  ) {
    return false;
  }

  // operation === "post": gate read-only channels behind announcements:post / *.
  if (!channel.is_read_only) return true;
  if (isPresident) return true;
  return permissions.includes(ANNOUNCEMENTS_POST_PERMISSION);
}
