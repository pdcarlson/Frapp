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
  create(data: Partial<ServiceEntry>): Promise<ServiceEntry>;
  update(
    id: string,
    chapterId: string,
    data: Partial<ServiceEntry>,
  ): Promise<ServiceEntry>;
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
  delete(id: string, chapterId: string): Promise<void>;
}
