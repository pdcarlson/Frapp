import { Member } from '../entities/member.entity';
import {
  PledgeClass,
  PledgeClassAssignment,
} from '../entities/pledge-class.entity';

export const PLEDGE_CLASS_REPOSITORY = 'PLEDGE_CLASS_REPOSITORY';

export interface IPledgeClassRepository {
  /** The chapter's list, oldest class first. */
  findByChapter(chapterId: string): Promise<PledgeClass[]>;
  findById(id: string, chapterId: string): Promise<PledgeClass | null>;
  /**
   * Resolves to `null` when the chapter already has a class of that name
   * (compared trimmed and case-insensitively by the unique index).
   */
  create(data: Partial<PledgeClass>): Promise<PledgeClass | null>;
  /**
   * `null` when the name is taken, as {@link create}; `undefined` when no such
   * class exists in the chapter.
   */
  rename(
    id: string,
    chapterId: string,
    name: string,
  ): Promise<PledgeClass | null | undefined>;
  /**
   * Sets each listed class's position to its place in `ids`, in one statement
   * (`reorder_chapter_pledge_classes`). Returns the rows it moved.
   */
  reorder(chapterId: string, ids: string[]): Promise<PledgeClass[]>;
  /** Members of the class keep their order number and lose the class. */
  delete(id: string, chapterId: string): Promise<void>;
  /**
   * Sets class and order number on each listed member of the chapter, in one
   * statement (`assign_member_pledge_classes`). Returns the rows it changed;
   * a member of another chapter is not among them.
   */
  assignMembers(
    chapterId: string,
    assignments: PledgeClassAssignment[],
  ): Promise<Member[]>;
}
