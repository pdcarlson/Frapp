import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  CHAT_CHANNEL_REPOSITORY,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  CHAT_MESSAGE_KINDS,
  SETTABLE_NOTIFICATION_KINDS,
  isChatMessageKind,
  isSettableNotificationKind,
} from '#domain/entities/chat.entity';
import { ChannelAccessService } from './channel-access.service';
import { ChatNotificationPreferenceRepository } from '../../modules/chat-push-worker/chat-notification-preference.repository';
import type { ChatNotificationLevel } from '../../modules/chat-push-worker/chat-notification-preference.repository';
import { resolveLevel } from '../../modules/chat-push-worker/push-rules';

/**
 * A member's own chat notification levels: per channel (#296) and per message
 * kind (#500).
 *
 * Split out of `ChatService` (#1380). It shares nothing with the chat hot path
 * but the channel-access check, and it answers with the push worker's own
 * `resolveLevel`, so what a member sees here is what the worker does.
 */
@Injectable()
export class ChatNotificationPreferenceService {
  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatNotificationPrefs: ChatNotificationPreferenceRepository,
  ) {}

  /**
   * The caller's EFFECTIVE channel-scoped notification levels (#296).
   *
   * Returned as its own collection rather than folded into the channel payload,
   * matching how unread counts are served. `channel-list.tsx` documents why: an
   * `unread_count?` field once sat on the channel type "populated by future
   * unread tracking", nothing ever populated it, and the badge reading it could
   * never render. `muted` was the second field in that state until this slice.
   *
   * **Effective, not stored — and that distinction is the whole point.** An
   * earlier cut of this returned only rows that exist in
   * `chat_notification_preferences`, leaving the client to assume `mentions`
   * for everything else. That is wrong for exactly the channels members most
   * want to turn down: `defaultLevelFor` sends `#general` and `#announcements`
   * to `all` and `#chapter-audit` to `off`, all three are seeded into every
   * chapter by `DEFAULT_CHANNELS`, and officers can set any channel's default
   * (#2771). The control would then have shown "Only @mentions" on a
   * channel actually pushing every message at URGENT, and — because the popover
   * suppresses a write for the option already displayed as current — the single
   * most natural corrective click did nothing at all.
   *
   * Resolving the default here rather than in the client keeps ONE
   * implementation of it, the one `push-rules.ts` already uses to decide real
   * pushes and that `push-rules.spec.ts` already pins. A second copy in web
   * could drift from the worker, and a UI that disagrees with the worker about
   * whether you are muted is worse than no UI.
   *
   * Only channels the caller can still read are returned. A preference row
   * survives losing access to its channel — leaving a private channel does not
   * delete the mute row — so keying the response off stored rows would let a
   * caller enumerate channel ids they can no longer read. Driving it off the
   * accessible channel list instead makes that impossible by construction.
   *
   * **Cost, stated rather than hidden.** This deliberately gives up the old
   * `if (rows.length === 0) return []` short-circuit, so every call now loads
   * the chapter's channels and runs the read predicate — the same work
   * `getUnreadCounts` already does per request — even for the majority of
   * members who have muted nothing. That is inherent to the contract: you
   * cannot report a channel's default without knowing the channel. It is
   * affordable because the web client's query key was simultaneously lifted
   * out of the `["channels"]` prefix, so this stopped being invalidated twice
   * on every channel switch; the per-call cost went up and the call count went
   * down. If it ever does show up, the fix is a projection on `findByChapter`
   * (`resolveLevel` reads `id`, `name`, `type`, `is_read_only` and
   * `default_notification_level`), not a return to guessing defaults
   * client-side.
   */
  async getChannelNotificationPreferences(chapterId: string, userId: string) {
    // BOTH arms are loaded, not just the channel one. Kind-scoped rows became
    // writable in #500, and `resolveLevel` consults them whenever a channel has
    // no row of its own (in a DM, only a louder one counts) — so reading only
    // the channel arm would report the pre-#500 answer. A member who sets the
    // `text` kind to `off` would see every channel rendered `mentions` here
    // while the worker pushed nothing, which is exactly the "UI that disagrees
    // with the worker about whether you are muted" this method's contract
    // exists to prevent.
    const [channelRows, kindRows, channels] = await Promise.all([
      this.chatNotificationPrefs.findChannelPreferencesForUser(
        userId,
        chapterId,
      ),
      this.chatNotificationPrefs.findKindPreferencesForUser(userId, chapterId),
      this.channelRepo.findByChapter(chapterId),
    ]);

    const accessible = await this.channelAccess.filterAccessibleChannels(
      chapterId,
      userId,
      channels,
    );
    if (accessible.length === 0) return [];

    const preferences = [...channelRows, ...kindRows];

    // Delegated to the worker's own `resolveLevel` rather than reimplementing
    // channel-pref ▶ kind-pref ▶ default here. The previous local version
    // silently fell out of step with the worker the moment the kind arm gained
    // a write path; sharing the function makes that class of drift structural
    // rather than something a reviewer has to notice.
    //
    // `'text'` is the ordinary-message kind: this endpoint answers "what does
    // this channel do for an ordinary message", not "what would this one
    // message do".
    return accessible.map((channel) => ({
      channel_id: channel.id,
      level: resolveLevel(channel, 'text', preferences),
    }));
  }

  /**
   * The caller's own per-kind notification overrides (#500).
   *
   * Every settable kind is returned; `level` is the stored override, or
   * **`null`** where the member has set none.
   *
   * `null` rather than a filled-in default, which is the one place this
   * endpoint deliberately differs from its per-channel sibling. A kind
   * preference is chapter-wide, but the default it would fall back to is
   * **not**: `defaultLevelFor` resolves an `announcement` message through the
   * channel's default, which is `all` in the announcements channel, #general
   * and DMs, whatever an officer set elsewhere, and `mentions` otherwise; and a
   * kind row never reaches a DM at all (#2771). So there is
   * no single chapter-wide default for a kind to report. Inventing one would
   * be worse than useless in two concrete ways — it would state `mentions` for
   * `announcement` when the seeded `#announcements` channel actually resolves
   * `all`, and a settings screen that PUT back what it displayed would thereby
   * *create* an override that silently downgrades that channel, with no way to
   * undo it short of the DELETE below.
   *
   * The effective level for a real message is the per-channel endpoint's
   * answer, which resolves the full channel-pref ▶ kind-pref ▶ default chain
   * (in a DM a kind row counts only when louder than the DM's `all`).
   * This endpoint answers only "what have I overridden".
   *
   * No channel-access check is needed or possible here: a kind is not a
   * channel, so the response reveals nothing about which channels exist.
   */
  async getKindNotificationPreferences(chapterId: string, userId: string) {
    const rows = await this.chatNotificationPrefs.findKindPreferencesForUser(
      userId,
      chapterId,
    );

    const stored = new Map<string, ChatNotificationLevel>();
    for (const row of rows) {
      if (row.scope_kind !== null) stored.set(row.scope_kind, row.level);
    }

    return SETTABLE_NOTIFICATION_KINDS.map((kind) => ({
      kind,
      level: stored.get(kind) ?? null,
    }));
  }

  /**
   * Clear the caller's override for one kind, returning it to the default.
   *
   * The counterpart to the setter, and not optional surface: because outside
   * DMs a kind override outranks every channel's default, an override a
   * member cannot remove is a permanent, invisible downgrade of
   * `#announcements`.
   *
   * **Validated against every `CHAT_MESSAGE_KIND`, not the settable subset**,
   * which is deliberate and is the one place these two routes disagree.
   * Deleting a row is never harmful, and gating the delete on settability
   * creates exactly the unremovable state this route exists to prevent:
   * moving a kind into {@link NON_SETTABLE_NOTIFICATION_KINDS} — as `loading`
   * just was — would strand any row already written for it, unreachable by
   * both the setter (400) and the clearer (400), while the worker went on
   * consulting it. The kind is still checked, so a typo cannot silently
   * delete nothing.
   *
   * Idempotent: clearing an override that is not set is a no-op, not a 404.
   * The caller's intent ("I want no override for this kind") is satisfied
   * either way, and reporting 404 would leak nothing useful while making a
   * retry after a dropped response fail.
   */
  async clearKindNotificationLevel(
    chapterId: string,
    userId: string,
    kind: string,
  ) {
    if (!isChatMessageKind(kind)) {
      throw new BadRequestException(
        `Unknown message kind '${kind}'. Known kinds: ` +
          CHAT_MESSAGE_KINDS.join(', '),
      );
    }

    await this.chatNotificationPrefs.deleteKindLevel(userId, chapterId, kind);
    return { kind, level: null };
  }

  /**
   * Set the caller's notification level for one message kind (#500).
   *
   * The kind is validated against {@link SETTABLE_NOTIFICATION_KINDS} rather
   * than trusted from the path. Two distinct reasons, both real:
   *
   * - `chat_messages.kind` carries **no CHECK constraint** (it is
   *   `text not null default 'text'`), so the database would happily store a
   *   preference for a misspelled or invented kind. That row would then sit
   *   there matching no message forever — a setting the member believes is
   *   active and which does nothing.
   * - `imported` must be refused specifically, not merely left unlisted. The
   *   push worker exits on that kind before any preference is read, so
   *   accepting the write would persist a row that can never be consulted.
   *
   * Keyed on `userId` from the authenticated request, never from the body —
   * same rule as the channel setter: accepting a caller-supplied user id would
   * let any member silence another member's notifications.
   */
  async setKindNotificationLevel(
    chapterId: string,
    userId: string,
    kind: string,
    level: ChatNotificationLevel,
  ) {
    if (!isSettableNotificationKind(kind)) {
      throw new BadRequestException(
        `Unsupported notification kind '${kind}'. Settable kinds: ` +
          SETTABLE_NOTIFICATION_KINDS.join(', '),
      );
    }

    const row = await this.chatNotificationPrefs.upsertKindLevel(
      userId,
      chapterId,
      kind,
      level,
    );
    return { kind, level: row.level };
  }

  /**
   * Set the caller's notification level for one channel.
   *
   * `assertChannelAccess` first, for the same reason `ChatService.markChannelRead`
   * does it:
   * `chat_channels` has RLS enabled with no policies (#1009) and the API holds
   * the `service_role` key, so this application-layer check is the only thing
   * stopping a caller from writing a preference row about a private channel or
   * a DM they are not part of — which would confirm that channel id exists.
   *
   * The row is keyed on `userId` from the authenticated request, never from the
   * body: a mute is per-user, and accepting a caller-supplied user id would let
   * any member silence another member's notifications.
   */
  async setChannelNotificationLevel(
    channelId: string,
    chapterId: string,
    userId: string,
    level: ChatNotificationLevel,
  ) {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);
    const row = await this.chatNotificationPrefs.upsertChannelLevel(
      userId,
      chapterId,
      channelId,
      level,
    );
    return { channel_id: channelId, level: row.level };
  }
}
