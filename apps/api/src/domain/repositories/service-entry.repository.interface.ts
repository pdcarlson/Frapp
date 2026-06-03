import { ServiceEntry } from '../entities/service-entry.entity';

export const SERVICE_ENTRY_REPOSITORY = 'SERVICE_ENTRY_REPOSITORY';

export interface IServiceEntryRepository {
  findById(id: string, chapterId: string): Promise<ServiceEntry | null>;
  findByChapter(chapterId: string): Promise<ServiceEntry[]>;
  findByUser(chapterId: string, userId: string): Promise<ServiceEntry[]>;
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
