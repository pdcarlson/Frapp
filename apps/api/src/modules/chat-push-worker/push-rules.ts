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

import type {
  ChatNotificationLevel,
  ChatNotificationPreferenceRow,
} from './chat-notification-preference.repository';

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
}

/**
 * Whether a channel is the chapter's announcements channel, for the default
 * level here and for the push's title, priority and category in the worker.
 *
 * Two shapes qualify, the union of what the two push paths used to check
 * separately before the worker became the only one (#2771):
 *
 * - a channel named exactly `announcements`, the seeded one;
 * - a PUBLIC, read-only channel whose name contains `announcements`, which is
 *   what `ChatService`'s own fan-out keyed on. Everyone reads it and only the
 *   `announcements:post` holders write it, so a chapter-wide URGENT push is
 *   sound. A channel merely *named* `intramural-announcements` that anyone can
 *   post in does not qualify, or any member could page the whole roster.
 *
 * Still name-keyed, and so still one rename from changing; narrowing it is
 * part of #1323.
 */
export function isAnnouncementChannel(channel: PushRuleChannel): boolean {
  if (channel.name === 'announcements') return true;
  return (
    channel.type === 'PUBLIC' &&
    channel.is_read_only === true &&
    channel.name.toLowerCase().includes('announcements')
  );
}

/** A 1:1 or group DM. Every message there is addressed to its members. */
export function isDirectChannel(channel: Pick<PushRuleChannel, 'type'>) {
  return channel.type === 'DM' || channel.type === 'GROUP_DM';
}

/**
 * Lift the user's effective level for this (channel, kind). Channel-scoped
 * rows beat kind-scoped rows beat defaults; the table allows both arms so a
 * user can mute a single channel without muting the whole kind.
 */
export function resolveLevel(
  channel: PushRuleChannel,
  messageKind: string,
  preferences: ChatNotificationPreferenceRow[],
): ChatNotificationLevel {
  const channelPref = preferences.find(
    (p) => p.scope === 'channel' && p.scope_id === channel.id,
  );
  if (channelPref) return channelPref.level;
  const kindPref = preferences.find(
    (p) => p.scope === 'kind' && p.scope_kind === messageKind,
  );
  if (kindPref) return kindPref.level;
  return defaultLevelFor(channel, messageKind);
}

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
 * 4. The built-in default, which is what an officer's "seeded" value is until
 *    they change it: `all` for the announcements channel and `#general`,
 *    `off` for `#chapter-audit`, `mentions` for the rest. Seeding it by rule
 *    rather than by writing rows means no backfill, and a chapter created
 *    tomorrow gets the same answer as one created a year ago.
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

/**
 * The default a chapter channel has before any officer sets one. Exported for
 * the channel payload, which reports it so the officer control can show what
 * "unset" currently means.
 */
export function builtInChannelDefault(
  channel: PushRuleChannel,
): ChatNotificationLevel {
  if (isDirectChannel(channel)) return 'all';
  if (isAnnouncementChannel(channel)) return 'all';
  if (channel.name === 'general') return 'all';
  if (channel.name === 'chapter-audit') return 'off';
  return 'mentions';
}

export type PushOutcome = 'send' | 'skip-level' | 'skip-presence';

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
 */
export function decidePush(input: PushDecisionInput): PushOutcome {
  if (input.messageKind === 'imported') return 'skip-level';
  if (input.recipientIsPresent) return 'skip-presence';
  const level = resolveLevel(
    input.channel,
    input.messageKind,
    input.preferences,
  );
  if (input.hasMention && input.messageKind !== 'system_audit') return 'send';
  if (level === 'off') return 'skip-level';
  if (level === 'mentions' && !input.hasMention) return 'skip-level';
  return 'send';
}
