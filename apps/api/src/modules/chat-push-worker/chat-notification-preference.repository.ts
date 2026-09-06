import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';
import { chunkIds } from '#domain/utils/chunk-ids';
import { toReportableError } from '../../infrastructure/observability/reportable-error';
import { fetchAllPages } from '../../infrastructure/supabase/supabase.utils';

/**
 * Rows per round trip when reading preferences for a batch of users.
 *
 * PostgREST caps a response at `max_rows` and signals truncation with a plain
 * 200 and a null error. The per-user read this replaced could not hit that cap
 * — one member's preferences are bounded by the channels and kinds they have
 * touched — but a batched read multiplies those rows by the chunk size, so the
 * cap becomes reachable and has to be paged for.
 *
 * The page size is a **request, not an assumption**: the shared
 * `fetchAllPages` advances by the rows that arrived and stops only on an
 * *empty* page, so it is correct whatever the server's cap turns out to be.
 * That matters because `supabase/config.toml`'s `max_rows = 1000` governs the
 * **local** stack only — the hosted project's Max rows is a dashboard setting
 * this code cannot read, so "our page size is below the cap" is not a fact any
 * file here can assert. That rule is #686's, generalised out of
 * `report.service.ts` into `infrastructure/supabase/supabase.utils.ts` by
 * #1628; this reads through that helper rather than restating it.
 */
export const PREFERENCE_PAGE_SIZE = 500;

/** Per-channel-or-kind notification level (ADR-06). */
export type ChatNotificationLevel = 'all' | 'mentions' | 'off';

export interface ChatNotificationPreferenceRow {
  user_id: string;
  chapter_id: string;
  scope: 'channel' | 'kind';
  scope_id: string | null;
  scope_kind: string | null;
  level: ChatNotificationLevel;
}

@Injectable()
export class ChatNotificationPreferenceRepository {
  private readonly logger = new Logger(
    ChatNotificationPreferenceRepository.name,
  );

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Load every chat-pref row for a batch of users in one chapter, grouped by
   * user. The push worker decides per-message whether the channel-specific row
   * or the kind-fallback row applies; loading both arms keeps the hot path
   * cheap.
   *
   * This replaced a per-user `findForUser`, which `handleMessage` awaited once
   * per recipient inside its loop — ~150 round trips per message in a
   * 150-member channel, on top of the membership query. There is deliberately
   * no single-user method left beside this one: the worker was the only caller,
   * and two live paths to the same rows is how the batched one silently stops
   * being the one that runs.
   *
   * **A user absent from the returned map has no stored preferences**, exactly
   * as the old empty array meant. Callers read it as `map.get(id) ?? []`.
   *
   * Chunked because a chapter-sized id list in one `in (...)` overflows the
   * request line and returns 414 (see the measurement in
   * `domain/utils/chunk-ids`), and paged because a batched read can reach
   * `max_rows` where a single user's read never could.
   *
   * **A query error never propagates**: the failing chunk degrades to absent
   * and the other chunks still return, because the worker must keep deciding
   * pushes for the rest of the batch and a missed mute beats a dropped
   * notification. That degradation is scoped to the query, and deliberately no
   * wider — an `Error` instance means something other than the query broke, and
   * `readChunkIsolated` rethrows it. Because the chunks run under
   * `Promise.all`, such a rethrow abandons the whole read, including chunks
   * that had already succeeded, and reaches `handleMessage`'s handler as a
   * dropped message rather than a wrong one. Both directions are intended; see
   * {@link readChunkIsolated} for why the narrowing is the load-bearing part.
   * The UI reads below throw unconditionally, and the contrast is deliberate;
   * see {@link findChannelPreferencesForUser}.
   */
  async findForUsers(
    userIds: string[],
    chapterId: string,
  ): Promise<Map<string, ChatNotificationPreferenceRow[]>> {
    const byUser = new Map<string, ChatNotificationPreferenceRow[]>();
    if (userIds.length === 0) return byUser;

    // Chunks run concurrently, as every other `chunkIds` consumer does
    // (`supabase-user.repository.ts`, `report.service.ts`): this is a
    // per-message hot path, and reading them in series would rebuild a smaller
    // version of the serialisation this method exists to remove.
    const chunks = await Promise.all(
      chunkIds(userIds).map((chunk) =>
        this.readChunkIsolated(chunk, chapterId),
      ),
    );

    for (const rows of chunks) {
      // `null` is a chunk that failed. Its members are left ABSENT rather than
      // half-populated, so they read as "no stored preferences" — exactly what
      // the per-user method returned when one member's lookup failed. A
      // partially-read user would be worse than an absent one: a missing
      // channel row silently resolves through to a kind row or the channel-name
      // default, which is a *different* level rather than the default one.
      if (!rows) continue;
      for (const row of rows) {
        const existing = byUser.get(row.user_id);
        if (existing) existing.push(row);
        else byUser.set(row.user_id, [row]);
      }
    }
    return byUser;
  }

  /**
   * One chunk's rows, or `null` if the *query* failed — the isolation boundary.
   *
   * Paging is the shared `fetchAllPages`
   * (`infrastructure/supabase/supabase.utils.ts`), which ends `if (error) throw
   * error` like every other repository read here
   * (`.claude/skills/api-development/SKILL.md`: "Always `if (error) throw
   * error;`") and refuses to let a partial read pass for a complete one.
   * Expressing the degradation at the call site instead is the policy that
   * helper documents, and the shape `scheduled-jobs.repository.ts` already uses.
   *
   * **The `catch` is narrowed on purpose, and the `instanceof` is the whole
   * point.** A PostgREST failure arrives as a PLAIN OBJECT: `fetchAllPages`
   * rethrows the `{ code, message, details, hint }` record verbatim, and
   * postgrest-js only constructs a `PostgrestError` *instance* on the
   * `.throwOnError()` path, which nothing in this codebase uses. So an `Error`
   * instance reaching here means something other than the query failed — a
   * defect in this file, or the helper's runaway-row guard. Swallowing one
   * would launder "this read is broken" into "these members stored no
   * preferences", which `decidePush` reads as *not muted* and pushes the whole
   * chunk anyway; a non-array 200 body is enough to trigger it. Those rethrow
   * into the worker's outer handler, which reports them, and only a real query
   * error degrades.
   *
   * `toReportableError` is the repo's own normalizer for a thrown PostgREST
   * shape: it rebuilds `{ code, message, details, hint }` into an `Error`
   * messaged `code: message: hint`, leaving out `details` — the field Postgres
   * fills with the offending row values (`spec/behavior/observability.md`, and
   * #1669). Logging its `message` is what keeps row data out of plaintext logs.
   *
   * That exclusion is **not** unconditional in the helper: an object carrying
   * none of `code`, `message` or `hint` falls through to `describeOpaque`,
   * which serializes the whole record, `details` included. Harmless here — not
   * because the client always fills `message` (an empty response body yields
   * `{ message: '' }`, which reads as absent), but because no producer of that
   * object emits `details` without `message`, so the opaque branch has no row
   * values to leak. #1762 tracks closing it in the shared helper rather than
   * here: it is shared with Sentry reporting and the global exception filter.
   *
   * All-or-nothing per chunk, deliberately, **for a query error**. Failing one
   * chunk that way costs at most `ID_CHUNK_SIZE` members their preferences for
   * this one message; returning what had been read so far would instead hand
   * back users whose row set is silently incomplete, and abandoning the
   * remaining chunks would strip preferences from members whose query never
   * even ran.
   *
   * The rethrow above is the one case that *does* abandon them, and it is not
   * an exception to that reasoning but the other side of it: a defect is not a
   * degraded read, so there is nothing to salvage the other chunks *for*.
   * `Promise.all` therefore rejects the whole call, discarding chunks that had
   * already succeeded, and the message is dropped instead of being pushed to
   * members whose mutes this read cannot vouch for.
   *
   * **Known limit, shared with every other paged read here.** `range()` is
   * OFFSET/LIMIT across independent statements, so a row deleted between two
   * pages shifts the window and the row that follows it is never read. Keyset
   * paging on `id` would be immune; this stays offset-based because that is
   * what the shared helper does. The exposure is small in practice — a chunk
   * reaches a second page only past `PREFERENCE_PAGE_SIZE` rows for 100
   * members — and the failure direction is a missed mute, the same one the
   * error path already accepts.
   */
  private async readChunkIsolated(
    chunk: string[],
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[] | null> {
    try {
      return await fetchAllPages<ChatNotificationPreferenceRow>(
        (from, to) =>
          this.supabase
            .from('chat_notification_preferences')
            .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
            .in('user_id', chunk)
            .eq('chapter_id', chapterId)
            // Offset paging needs a total order or a row sharing a sort value
            // across a page boundary is served twice or skipped. `id` is the
            // primary key, so it is unconditionally total and needs no
            // projection — the same key every other paged read here sorts on.
            .order('id', { ascending: true })
            .range(from, to),
        { pageSize: PREFERENCE_PAGE_SIZE },
      );
    } catch (error) {
      if (error instanceof Error) throw error;
      this.logger.warn(
        `chat-prefs: batch lookup failed for ${chunk.length} users in chapter ${chapterId}` +
          // The chunk's first id, not its length alone. This degradation is
          // silent by design — its members read as "no stored preferences",
          // which `decidePush` treats as *not muted* — so the only symptom is a
          // member pushed despite an explicit `off`. A 1000-member chapter
          // otherwise emits ten identical `for 100 users` lines per message and
          // an operator holding such a report can correlate it with none of
          // them. One id bounds the log line while still identifying the chunk.
          ` (from ${chunk[0]}) (${toReportableError(error).message})`,
      );
      return null;
    }
  }

  /**
   * Channel-scoped rows only, for the caller's own mute UI.
   *
   * Unlike {@link findForUsers}, this one **throws** rather than degrading to
   * an empty array. The worker swallows because a failed preference lookup
   * there should not stop a push from being decided at all — a missed mute is
   * better than a dropped notification. Here the array *is* the answer: `[]`
   * on a database error would render every channel as unmuted, which is
   * indistinguishable from the user having muted nothing, and the UI would
   * silently lie about their settings.
   */
  async findChannelPreferencesForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]> {
    return this.findPreferencesForUserByScope(userId, chapterId, 'channel');
  }

  /**
   * Kind-scoped rows only, for the caller's own per-kind settings UI.
   *
   * Throws rather than degrading to `[]`, for the same reason as
   * {@link findChannelPreferencesForUser}: here the array *is* the answer, and
   * an empty one on a database error would render every kind as un-overridden,
   * indistinguishable from the user having set nothing.
   */
  async findKindPreferencesForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChatNotificationPreferenceRow[]> {
    return this.findPreferencesForUserByScope(userId, chapterId, 'kind');
  }

  /**
   * Drop the caller's kind-scoped row, returning that kind to its default.
   *
   * Scoped by `user_id` AND `chapter_id` as well as the kind: the delete must
   * be unable to reach another member's row or the same member's row in a
   * chapter this request is not for, exactly as the upsert's conflict key is.
   *
   * Deleting a row that does not exist is a success, not an error — PostgREST
   * reports zero affected rows and the caller's intent is already satisfied.
   */
  async deleteKindLevel(
    userId: string,
    chapterId: string,
    kind: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chat_notification_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('scope', 'kind')
      .eq('scope_kind', kind);

    if (error) throw error;
  }

  /**
   * The shared body of the two scope-specific finders above. They differ only
   * in the `scope` literal, and jscpd flagged them as clones; the public
   * methods stay separate because their *contracts* differ (each is documented
   * against its own arm and its own caller), but the query lives once.
   */
  private async findPreferencesForUserByScope(
    userId: string,
    chapterId: string,
    scope: 'channel' | 'kind',
  ): Promise<ChatNotificationPreferenceRow[]> {
    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .eq('scope', scope);

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Set the caller's level for one message kind.
   *
   * `onConflict` names the columns of `idx_chat_notif_prefs_kind_unique`
   * (20260902170000) — the kind arm's counterpart to the channel arm's
   * `idx_chat_notif_prefs_channel_unique`. It deliberately does NOT target the
   * channel index: that one is on `scope_id`, which is NULL on every kind row,
   * so `ON CONFLICT` would match nothing and each call would INSERT a duplicate
   * instead of updating. Nor can it target the original expression index — see
   * that migration's header for why PostgREST cannot name a `coalesce(...)`
   * index.
   *
   * `updated_at` is left to the table's trigger, one writer for that column.
   */
  async upsertKindLevel(
    userId: string,
    chapterId: string,
    kind: string,
    level: ChatNotificationLevel,
  ): Promise<ChatNotificationPreferenceRow> {
    const row: TablesInsert<'chat_notification_preferences'> = {
      user_id: userId,
      chapter_id: chapterId,
      scope: 'kind',
      // Explicitly null, not omitted — mirror of the channel upsert: the
      // table's `chat_notif_prefs_scope_id_when_channel` CHECK requires
      // scope_id to be null on a kind row, and an upsert that updates an
      // existing row must clear it rather than leave whatever was there.
      scope_id: null,
      scope_kind: kind,
      level,
    };

    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .upsert(row, { onConflict: 'user_id,chapter_id,scope,scope_kind' })
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error(
        'chat-prefs: upsert returned no row for ' +
          `user ${userId}, kind ${kind}`,
      );
    }
    return data;
  }

  /**
   * Set the caller's level for one channel.
   *
   * `onConflict` names the columns of `idx_chat_notif_prefs_channel_unique`
   * (20260829011200) — the plain `(user_id, chapter_id, scope, scope_id)`
   * index added for exactly this call, and the reason setting a channel level
   * twice updates rather than accumulating rows.
   *
   * It deliberately does NOT target `idx_chat_notif_prefs_unique`
   * (20260527120000), and it cannot: that one is expression-based on
   * `coalesce(scope_id::text, scope_kind)`, `ON CONFLICT` only matches an index
   * defined on those exact columns or expressions, and PostgREST's
   * `on_conflict` takes column NAMES and cannot express `coalesce(...)`.
   * Against the expression index alone Postgres raises `42P10 there is no
   * unique or exclusion constraint matching the ON CONFLICT specification`, so
   * this write would 500 on every call. Both indexes are load-bearing: the
   * expression one still enforces the real invariant across both scope arms,
   * and dropping the plain one breaks this method — see that migration's
   * ROLLBACK note.
   *
   * `updated_at` is left to the table's `trg_chat_notification_preferences_updated_at`
   * trigger rather than being set here — one writer for that column, not two.
   */
  async upsertChannelLevel(
    userId: string,
    chapterId: string,
    channelId: string,
    level: ChatNotificationLevel,
  ): Promise<ChatNotificationPreferenceRow> {
    const row: TablesInsert<'chat_notification_preferences'> = {
      user_id: userId,
      chapter_id: chapterId,
      scope: 'channel',
      scope_id: channelId,
      // Explicitly null, not omitted: the table's
      // `chat_notif_prefs_scope_id_when_channel` CHECK requires scope_kind to
      // be null on a channel row, and an upsert that updates an existing row
      // must clear it rather than leave whatever was there.
      scope_kind: null,
      level,
    };

    const { data, error } = await this.supabase
      .from('chat_notification_preferences')
      .upsert(row, { onConflict: 'user_id,chapter_id,scope,scope_id' })
      .select('user_id, chapter_id, scope, scope_id, scope_kind, level')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error(
        'chat-prefs: upsert returned no row for ' +
          `user ${userId}, channel ${channelId}`,
      );
    }
    return data;
  }
}
