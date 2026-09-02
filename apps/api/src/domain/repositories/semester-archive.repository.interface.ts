import type { SemesterArchive } from '../entities/semester-archive.entity';

export const SEMESTER_ARCHIVE_REPOSITORY = 'SEMESTER_ARCHIVE_REPOSITORY';

export interface ISemesterArchiveRepository {
  findByChapter(chapterId: string): Promise<SemesterArchive[]>;
  findLatestByChapter(chapterId: string): Promise<SemesterArchive | null>;
  /**
   * A single archive, scoped to `chapterId` so an id from another chapter
   * (guessed or leaked) never resolves — the caller treats a miss the same as
   * an unknown id, never distinguishing "wrong chapter" from "doesn't exist".
   */
  findById(id: string, chapterId: string): Promise<SemesterArchive | null>;
  create(data: Partial<SemesterArchive>): Promise<SemesterArchive>;
  /**
   * Archive the period AND promote every New Member in the chapter to Member,
   * in one transaction. Used only when the caller asked for promotion — a plain
   * rollover is a single write and stays on {@link create}.
   *
   * Both role ids resolve by `roles.system_key`, never by name. The underlying
   * RPC does array surgery on `members.role_ids` (remove New Member, append
   * Member when absent), so members keep every other role they hold.
   */
  createWithPromotion(params: {
    chapterId: string;
    label: string;
    startDate: string;
    endDate: string;
    newMemberRoleId: string;
    memberRoleId: string;
  }): Promise<SemesterArchive>;
}
