/**
 * Per-recipient push rule chain (Chunk 05).
 *
 * Pure decision logic; the worker injects the data. Separating the chain
 * from Supabase makes the rules testable without spinning up the realtime
 * subscription.
 *
 * Default tier (channel name → level) is applied only when the user has no
 * stored preference for the channel or its kind:
 *   - `announcements` → `all`
 *   - `chapter-audit` → `off`
 *   - everything else → `mentions`
 */

import type {
  ChatNotificationLevel,
  ChatNotificationPreferenceRow,
} from './chat-notification-preference.repository';

export interface PushDecisionInput {
  channelName: string;
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
 * Lift the user's effective level for this (channel, kind). Channel-scoped
 * rows beat kind-scoped rows beat defaults; the table allows both arms so a
 * user can mute a single channel without muting the whole kind.
 */
export function resolveLevel(
  channelName: string,
  channelId: string | null,
  messageKind: string,
  preferences: ChatNotificationPreferenceRow[],
): ChatNotificationLevel {
  if (channelId) {
    const channelPref = preferences.find(
      (p) => p.scope === 'channel' && p.scope_id === channelId,
    );
    if (channelPref) return channelPref.level;
  }
  const kindPref = preferences.find(
    (p) => p.scope === 'kind' && p.scope_kind === messageKind,
  );
  if (kindPref) return kindPref.level;
  return defaultLevelFor(channelName, messageKind);
}

export function defaultLevelFor(
  channelName: string,
  messageKind: string,
): ChatNotificationLevel {
  if (messageKind === 'system_audit') return 'off';
  // An imported archive message is history, not news. Unlike `system_audit`,
  // whose `off` is a default a member can opt out of, this one is absolute —
  // `decidePush` refuses the kind outright before any preference is consulted.
  // The level is still stated here so anything reading a level directly agrees
  // with the decision the chain makes.
  if (messageKind === 'imported') return 'off';
  if (channelName === 'announcements') return 'all';
  if (channelName === 'chapter-audit') return 'off';
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
export function decidePush(
  input: PushDecisionInput,
  channelId: string | null,
): PushOutcome {
  if (input.messageKind === 'imported') return 'skip-level';
  if (input.recipientIsPresent) return 'skip-presence';
  const level = resolveLevel(
    input.channelName,
    channelId,
    input.messageKind,
    input.preferences,
  );
  if (input.hasMention && input.messageKind !== 'system_audit') return 'send';
  if (level === 'off') return 'skip-level';
  if (level === 'mentions' && !input.hasMention) return 'skip-level';
  return 'send';
}
