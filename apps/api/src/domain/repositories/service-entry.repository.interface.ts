import {
  ServiceEntry,
  ServiceEntryFilters,
  ServiceLeaderboardRow,
} from '../entities/service-entry.entity';

export const SERVICE_ENTRY_REPOSITORY = 'SERVICE_ENTRY_REPOSITORY';

export interface IServiceEntryRepository {
  findById(id: string, chapterId: string): Promise<ServiceEntry | null>;
  /**
   * The one chapter-scoped list read: optional status / date-range / member
   * filters applied in SQL (backed by
   * `idx_service_entries_chapter_status_date`) rather than by scanning every
   * chapter row in Node. An empty filter set lists the whole chapter; passing
   * only `userId` lists one member's history.
   */
  findByChapterFiltered(
    chapterId: string,
    filters: ServiceEntryFilters,
  ): Promise<ServiceEntry[]>;
  /**
   * Chapter-wide leaderboard over APPROVED entries, aggregated by the
   * `get_service_leaderboard` RPC. Ordered by total approved minutes
   * descending, then member name — the tie-break keeps paging stable.
   */
  leaderboard(
    chapterId: string,
    range: { startDate?: string; endDate?: string },
  ): Promise<ServiceLeaderboardRow[]>;
  /**
   * Inserts the entry. When the insert meets
   * `service_entries_chapter_proof_path_key` (another entry in the chapter
   * already holds this `proof_path`), returns that entry instead, which may
   * be another member's: whether the caller may have it is the service's
   * call (`ServiceEntryService.create`).
   */
  create(data: Partial<ServiceEntry>): Promise<ServiceEntry>;
  /**
   * The entry in the chapter whose proof is the file at this path, or null.
   * The oldest one if entries from before a proof path was one entry's alone
   * still share it.
   */
  findByProofPath(
    chapterId: string,
    proofPath: string,
  ): Promise<ServiceEntry | null>;
  /**
   * Entries in the chapter whose proof is the file at this path: a proof
   * file belongs to one entry, and is deleted only once none points at it.
   */
  countByProofPath(chapterId: string, proofPath: string): Promise<number>;
  /**
   * Rejects a PENDING entry in one conditional update, so it can't land on
   * an entry a concurrent approval already took (the counterpart of
   * `approveAtomic`'s compare-and-set). Returns the rejected entry, or null
   * when it is missing or no longer PENDING.
   */
  rejectIfPending(
    id: string,
    chapterId: string,
    reviewerId: string,
    reviewComment: string | null,
  ): Promise<ServiceEntry | null>;
  /**
   * Atomically approve a PENDING service entry and award its SERVICE points in a
   * single DB transaction (compare-and-set on `status`/`points_awarded`).
   * `points` is the precomputed award amount; 0 approves the entry without a
   * ledger row. Returns the approved entry, or `null` when nothing was updated:
   * the entry is missing, no longer PENDING, or already awarded (e.g. a
   * concurrent approval won the race).
   */
  approveAtomic(
    id: string,
    chapterId: string,
    reviewerId: string,
    reviewComment: string | null,
    points: number,
  ): Promise<ServiceEntry | null>;
  /**
   * Deletes the entry only while it is PENDING, in one conditional delete, so
   * an approval that landed first keeps its entry. Returns the deleted entry,
   * or null when it is missing or no longer PENDING.
   */
  deleteIfPending(id: string, chapterId: string): Promise<ServiceEntry | null>;
}
