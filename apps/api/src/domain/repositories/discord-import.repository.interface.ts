import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
  DiscordImportStatus,
} from '../entities/discord-import.entity';
import type {
  ImportedAttachmentRow,
  ImportedMessageRow,
} from '../utils/discord-export';

export const DISCORD_IMPORT_REPOSITORY = 'DISCORD_IMPORT_REPOSITORY';

/** Which of the two archive ceilings a batch crossed. */
export type ArchiveQuotaScope = 'import' | 'chapter';

/**
 * A batch was refused because it would cross an archive ceiling (#1243).
 *
 * A domain error rather than an HTTP one: the same refusal has to reach an
 * admin as a 400 on the upload path and stop the job with a readable reason on
 * the bot path, and only the callers know which. It carries the measured
 * numbers so neither caller has to re-derive them.
 */
export class ArchiveQuotaExceededError extends Error {
  constructor(
    readonly scope: ArchiveQuotaScope,
    readonly wouldHoldBytes: number,
    readonly capBytes: number,
  ) {
    super(
      `Discord archive ${scope} quota exceeded: ${wouldHoldBytes} bytes against a ${capBytes} byte ceiling`,
    );
    this.name = 'ArchiveQuotaExceededError';
  }
}

/** What a claimed job hands the worker: the row plus the token it must hold. */
export interface ClaimedDiscordImport {
  job: DiscordImport;
  lockToken: string;
}

export interface DiscordImportProgressPatch {
  imported_messages?: number;
  messages_skipped?: number;
  attachments_imported?: number;
  attachments_skipped?: number;
  cursor_part_index?: number;
  cursor_message_index?: number;
  cursor_part_message_count?: number;
  parts_total?: number;
  total_messages?: number;
  warnings?: string[];
  status?: DiscordImportStatus;
  error?: string | null;
  completed_at?: string | null;
  purged_at?: string | null;
  guild_id?: string | null;
  guild_name?: string | null;
}

/**
 * Persistence for the Discord archive importer.
 *
 * Every read and write binds `chapter_id`, per the multi-tenancy invariant —
 * scope the query, do not read-then-check. The two exceptions are the worker's
 * own claim path (`claimNextRunnable`, `renewLease`, `releaseLease`), which is
 * chapter-agnostic by nature: the sweeper serves every chapter, and the job row
 * it claims carries the chapter it then works within.
 */
export interface IDiscordImportRepository {
  create(
    data: Pick<DiscordImport, 'chapter_id' | 'consent_acknowledged_at'> &
      Partial<
        Pick<
          DiscordImport,
          'created_by' | 'guild_id' | 'guild_name' | 'storage_prefix' | 'source'
        >
      >,
  ): Promise<DiscordImport>;

  findById(id: string, chapterId: string): Promise<DiscordImport | null>;
  findByChapter(chapterId: string): Promise<DiscordImport[]>;

  update(
    id: string,
    chapterId: string,
    patch: DiscordImportProgressPatch &
      Partial<Pick<DiscordImport, 'role_mapping' | 'storage_prefix'>>,
  ): Promise<DiscordImport>;

  /**
   * Update, but only while the import is still in one of `expectedStatuses`.
   * Returns null when it is not — which is how the worker learns the admin
   * cancelled it, or that another writer moved it on.
   *
   * The lease protects against another *worker*; it does nothing against an
   * admin calling cancel or delete mid-slice, because that is an ordinary API
   * write on the same row. Without this guard the slice's closing
   * `status: 'running'` overwrites `cancelled` and the next tick picks the job
   * straight back up — a cancel button that does nothing.
   */
  updateIfStatus(
    id: string,
    chapterId: string,
    expectedStatuses: DiscordImportStatus[],
    patch: DiscordImportProgressPatch,
  ): Promise<DiscordImport | null>;

  // ── channels ──────────────────────────────────────────────────────────────
  replaceChannels(
    importId: string,
    chapterId: string,
    rows: Omit<DiscordImportChannel, 'id' | 'import_id'>[],
  ): Promise<DiscordImportChannel[]>;
  /**
   * This import's channels, in the order the worker must walk them.
   *
   * Ordered by `position` first, then name. The upload path leaves `position`
   * at its default 0 and so keeps its original name ordering exactly; the bot
   * path pins a position at discovery so a thread lists directly under its
   * parent and a later change to the sort key cannot reorder a half-finished
   * import.
   */
  findChannels(
    importId: string,
    chapterId: string,
  ): Promise<DiscordImportChannel[]>;
  updateChannel(
    id: string,
    importId: string,
    patch: Partial<
      Pick<
        DiscordImportChannel,
        | 'mapping_action'
        | 'target_channel_id'
        | 'new_channel_name'
        | 'new_channel_is_read_only'
        | 'message_count'
        | 'imported_count'
        | 'status'
        | 'error'
        | 'cursor_before_snowflake'
      >
    >,
  ): Promise<void>;

  // ── uploaded files ────────────────────────────────────────────────────────
  /**
   * Register manifest rows, refusing the whole batch if it would take the
   * import or the chapter past its archive ceiling (#1243).
   *
   * Registration and enforcement are ONE call because they have to be one
   * transaction. Splitting them — measure, then write — let ten concurrent mint
   * requests all pass the same pre-batch total, which multiplied the ceiling by
   * the concurrency; `CustomThrottlerGuard` bounds request rate, not in-flight
   * concurrency, so nothing else closed that. There is deliberately no
   * unchecked "just insert the rows" method left on this interface: the bot
   * importer writes to the same bucket and needs the same ceiling, and an
   * unguarded door here is how it would keep bypassing one.
   *
   * Recorded sizes are **monotonic** — a re-registered path may raise its
   * `byte_size`, never lower it. Without that the upsert was a way to erase the
   * accounting for objects already in the bucket, which is a cheaper bypass
   * than under-declaring in the first place.
   *
   * Throws {@link ArchiveQuotaExceededError} when a ceiling is hit; the batch
   * is then fully rolled back, so a refused request registers nothing.
   */
  registerFiles(
    chapterId: string,
    importId: string,
    rows: Omit<DiscordImportFile, 'id' | 'created_at' | 'uploaded_at'>[],
    caps: { importBytes: number; chapterBytes: number },
  ): Promise<DiscordImportFile[]>;
  findFiles(importId: string, chapterId: string): Promise<DiscordImportFile[]>;
  markFilesUploaded(
    importId: string,
    chapterId: string,
    storagePaths: string[],
    at: string,
  ): Promise<number>;

  // ── the worker's lease ────────────────────────────────────────────────────
  /**
   * Claim one runnable job, or null when there is nothing to do or the race was
   * lost. Compare-and-swap on `lock_token`: `@Cron` fires on every replica, so
   * the claim has to be the thing that decides, not the read that preceded it.
   */
  claimNextRunnable(
    now: Date,
    leaseMs: number,
    workerId: string,
  ): Promise<ClaimedDiscordImport | null>;

  /** Extend a held lease. False means the lease was lost — stop working. */
  renewLease(
    id: string,
    lockToken: string,
    now: Date,
    leaseMs: number,
  ): Promise<boolean>;

  /** Hand the job back for the next tick, keeping its status. */
  releaseLease(id: string, lockToken: string): Promise<void>;

  // ── the import write path ─────────────────────────────────────────────────
  /**
   * Which of these Discord snowflakes are already in this channel.
   *
   * The importer reads before it writes rather than upserting, and that is a
   * measured decision, not a preference: `idx_chat_messages_external_dedupe` is
   * a PARTIAL unique index, and PostgREST cannot use one as an `ON CONFLICT`
   * arbiter. Verified against the local stack — `Prefer:
   * resolution=ignore-duplicates` still answers 409/23505, and naming the
   * arbiter explicitly answers 42P10 "no unique or exclusion constraint
   * matching the ON CONFLICT specification", because Postgres needs the index
   * predicate restated and PostgREST has no syntax for it. (Bare SQL
   * `on conflict do nothing` does respect the index; it is the HTTP layer that
   * cannot express it.)
   *
   * The read is not wasted work: its result is also what resolves reply targets
   * and what makes `messages_skipped` a real number on a re-run.
   */
  findExistingExternalIds(
    channelId: string,
    externalMessageIds: string[],
  ): Promise<Map<string, string>>;

  /** Insert imported messages, returning id keyed by external id. */
  insertMessages(rows: ImportedMessageRow[]): Promise<Map<string, string>>;

  /**
   * Point already-imported messages at their reply targets.
   *
   * A second pass, because a reply and the message it answers routinely arrive
   * in the SAME batch: the pre-insert existence read cannot know an id that
   * does not exist yet, so those replies land with a null `reply_to_id` and are
   * repaired here once both rows have ids.
   */
  setReplyTargets(
    pairs: { id: string; reply_to_id: string }[],
  ): Promise<number>;

  insertAttachments(
    rows: (ImportedAttachmentRow & {
      message_id: string;
      channel_id: string;
    })[],
  ): Promise<number>;

  // ── purge ─────────────────────────────────────────────────────────────────
  /**
   * Delete up to `limit` imported messages for this import, within this
   * chapter's channels. Returns how many went. Cascades take the attachments,
   * actions and reactions with them.
   */
  deleteImportedMessages(
    importId: string,
    chapterId: string,
    limit: number,
  ): Promise<number>;
}
