/**
 * Per-recipient push rule chain (Chunk 05).
 *
 * Pure decision logic; the worker injects the data. Separating the chain
 * from Supabase makes the rules testable without spinning up the realtime
 * subscription.
 *
 * The default tier is applied only when the user has no stored preference for
 * the channel or its kind. `defaultLevelFor` below is the whole rule and its
 * precedence order — kind, then channel type, then the officer's stored
 * default, then the built-in one — so read it rather than a summary here.
 */

import {
  builtInChannelDefault,
  isAnnouncementChannel,
  isDirectChannel,
} from '@repo/validation';
import type { ChatNotificationLevel } from '#domain/entities/chat-notification-preference.entity';
import type { ChatNotificationPreferenceRow } from '#domain/repositories/chat-notification-preference.repository.interface';

/**
 * The parts of a `chat_channels` row the rules read. Structural, so both the
 * worker's cached row and `ChatService`'s `ChatChannel` satisfy it unmapped.
 */
export interface PushRuleChannel {
  id: string;
  name: string;
  /** `PUBLIC` / `PRIVATE` / `ROLE_GATED` / `DM` / `GROUP_DM`. */
  type: string;
  is_read_only: boolean | null;
  /**
   * The officer-set default for this channel (#2771). `null` (or absent)
   * means no officer has chosen one, and the built-in default applies.
   */
  default_notification_level?: ChatNotificationLevel | null;
}

export interface PushDecisionInput {
  channel: PushRuleChannel;
  /** `chat_messages.kind` — `text`/`announcement`/`system_audit`/… */
  messageKind: string;
  /** Whether the recipient is currently in the channel's Realtime Presence map. */
  recipientIsPresent: boolean;
  /** `true` if the message mentions the recipient — drives the `mentions` level. */
  hasMention: boolean;
  /** Pref rows for the (user, chapter). Empty means "no preference set". */
  preferences: ChatNotificationPreferenceRow[];
  /**
   * The row is an audit-log mirror in `#chapter-audit` (`isAuditMirrorRow`),
   * not one of the server's own `system_audit` notices. Mirrors are delivered
   * silently: no preference turns them back on.
   */
  isAuditMirror?: boolean;
  /**
   * Set when the row is a reply inside a message thread (#3785): the
   * recipient's follow state for that thread, `null` when they do not follow
   * it. Absent for a timeline message.
   */
  thread?: { followState: 'following' | 'muted' | null };
}

/** Where a member's effective level for a channel came from. */
export type ChatLevelSource =
  /** The member set this channel (or DM) themselves. */
  | 'channel'
  /** The member's per-kind override. */
  | 'kind'
  /** The member's chapter-wide chat level (#3840), "Mentions and DMs only". */
  | 'chapter'
  /** Nobody chose: the officer's or the built-in channel default. */
  | 'default';

/**
 * Lift the user's effective level for this (channel, kind). Channel-scoped
 * rows beat kind-scoped rows beat the chapter-wide row beat defaults; the
 * table allows every arm so a user can mute a single channel without muting
 * the whole kind.
 *
 * **In a DM or group DM a kind row can make it louder, never quieter.** A kind
 * override is a chapter-wide way to tune channel traffic, and until #2771 DMs
 * were pushed by a separate path that never read it. Letting a `text` row of
 * `mentions` apply would silently stop every DM for a member who set it to
 * calm #general, so a kind row below the DM's default is ignored there and a
 * DM is muted from the DM itself. A kind row above it still counts, so a
 * `system_audit` opt-in keeps reaching system messages posted into DMs (the
 * invite-accept notice, a DM poll's expiry), as it did before.
 *
 * **The chapter-wide row only ever lowers an ordinary channel's default**
 * (#3840). "Mentions and DMs only" means every channel acts as `mentions`,
 * while DMs, group DMs and the announcements channel (URGENT) keep notifying.
 * So it never reaches a DM or the announcements channel, and it never raises a
 * channel whose default is already quieter (`#chapter-audit`, an officer's
 * `off`, the `system_audit` kind's `off`).
 */
export function resolveLevel(
  channel: PushRuleChannel,
  messageKind: string,
  preferences: ChatNotificationPreferenceRow[],
): ChatNotificationLevel {
  return resolveLevelWithSource(channel, messageKind, preferences).level;
}

/** {@link resolveLevel}, plus which preference decided it. */
export function resolveLevelWithSource(
  channel: PushRuleChannel,
  messageKind: string,
  preferences: ChatNotificationPreferenceRow[],
): { level: ChatNotificationLevel; source: ChatLevelSource } {
  const channelPref = preferences.find(
    (p) => p.scope === 'channel' && p.scope_id === channel.id,
  );
  if (channelPref) return { level: channelPref.level, source: 'channel' };
  const kindPref = preferences.find(
    (p) => p.scope === 'kind' && p.scope_kind === messageKind,
  );
  const fallback = defaultLevelFor(channel, messageKind);
  if (isDirectChannel(channel)) {
    return kindPref && LOUDNESS[kindPref.level] > LOUDNESS[fallback]
      ? { level: kindPref.level, source: 'kind' }
      : { level: fallback, source: 'default' };
  }
  if (kindPref) return { level: kindPref.level, source: 'kind' };
  const chapterPref = preferences.find((p) => p.scope === 'chapter');
  if (
    chapterPref &&
    !isAnnouncementChannel(channel) &&
    LOUDNESS[chapterPref.level] < LOUDNESS[fallback]
  ) {
    return { level: chapterPref.level, source: 'chapter' };
  }
  return { level: fallback, source: 'default' };
}

/** How much each level lets through, for comparing two of them. */
const LOUDNESS: Record<ChatNotificationLevel, number> = {
  off: 0,
  mentions: 1,
  all: 2,
};

/**
 * The level for a member who has set nothing for this channel or kind.
 *
 * Kind first, then the channel:
 *
 * 1. `system_audit` and `imported` are `off` whatever the channel says. The
 *    owner's decision on #2771 left both as they were, so an officer's `all`
 *    on `#chapter-audit` does not start paging people with audit rows.
 * 2. A DM or group DM is `all`. Its messages are addressed to its members, as
 *    Discord's and every messenger's DMs are, and it has no officer to choose
 *    otherwise. Until #2771 this came from a second push path in `ChatService`
 *    that ignored the member's own mute; now a DM mute holds.
 * 3. The officer-set channel default, when one is stored.
 * 4. The built-in default (`builtInChannelDefault` in `@repo/validation`,
 *    shared with the web officer control that displays it): `all` for the
 *    announcements channel (PUBLIC and read-only, `isAnnouncementChannel`) and
 *    `#general`, `off` for `#chapter-audit`, `mentions` for the rest.
 */
export function defaultLevelFor(
  channel: PushRuleChannel,
  messageKind: string,
): ChatNotificationLevel {
  if (messageKind === 'system_audit') return 'off';
  // An imported archive message is history, not news. Unlike `system_audit`,
  // whose `off` is a default a member can opt out of, this one is absolute —
  // `decidePush` refuses the kind outright before any preference is consulted.
  // The level is still stated here so anything reading a level directly agrees
  // with the decision the chain makes.
  if (messageKind === 'imported') return 'off';
  if (isDirectChannel(channel)) return 'all';
  if (channel.default_notification_level) {
    return channel.default_notification_level;
  }
  return builtInChannelDefault(channel);
}

export type PushOutcome =
  'send' | 'skip-level' | 'skip-presence' | 'skip-thread';

/**
 * Apply the full chain. Order matters: presence is the cheapest skip and the
 * one that protects users from notifications they don't need (they're
 * actively reading). Level filtering follows.
 *
 * @mentions override a muted channel: an explicit (or default) `off` level is
 * bypassed when the recipient is mentioned (spec `behavior/notifications.md`,
 * "Per-Channel Mute"). The one exception is the `system_audit` kind — audit
 * messages never page anyone unless explicitly opted in (ADR-06), so a mention
 * does not lift their `off` default.
 *
 * `imported` is refused before any of that. It is checked FIRST, ahead of even
 * the presence skip, because it is the only rule here with no escape hatch: an
 * archived Discord message from 2019 must not page anybody, and the mention
 * override is exactly how it otherwise would. Imported bodies are historical
 * prose full of `@name` tokens, and a mention lifts a muted channel's `off`, so
 * a kind-level `off` alone would not hold. There is deliberately no preference
 * that turns this back on — "notify me about backfilled history" is not a
 * setting anyone wants, and `ChatPushWorkerService.handleMessage` already exits
 * before it gets here.
 *
 * An audit mirror is refused the same way (owner decision 2026-11-06: audit
 * entries arrive silently). A member's `all` on `#chapter-audit`, or the
 * `system_audit` kind opt-in, would otherwise page them for every settings
 * save. The kind opt-in still reaches the server's own `system_audit` notices.
 */
export function decidePush(input: PushDecisionInput): PushOutcome {
  if (input.messageKind === 'imported' || input.isAuditMirror) {
    return 'skip-level';
  }
  if (input.recipientIsPresent) return 'skip-presence';
  const level = resolveLevel(
    input.channel,
    input.messageKind,
    input.preferences,
  );
  if (input.hasMention && input.messageKind !== 'system_audit') return 'send';
  // A thread reply reaches only the thread's followers, and never more than
  // the channel's level allows (#3785, spec/behavior/chat/README.md § Message
  // threads). The mention above is the one exception, as it is for a muted
  // channel: a muted thread still hears an @mention.
  if (input.thread && input.thread.followState !== 'following') {
    return 'skip-thread';
  }
  if (level === 'off') return 'skip-level';
  if (level === 'mentions' && !input.hasMention) return 'skip-level';
  return 'send';
}
