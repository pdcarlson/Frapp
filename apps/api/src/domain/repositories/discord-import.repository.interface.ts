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
          'created_by' | 'guild_id' | 'guild_name' | 'storage_prefix'
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

  // ── channels ──────────────────────────────────────────────────────────────
  replaceChannels(
    importId: string,
    chapterId: string,
    rows: Omit<DiscordImportChannel, 'id' | 'import_id'>[],
  ): Promise<DiscordImportChannel[]>;
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
      >
    >,
  ): Promise<void>;

  // ── uploaded files ────────────────────────────────────────────────────────
  createFiles(
    rows: Omit<DiscordImportFile, 'id' | 'created_at' | 'uploaded_at'>[],
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
