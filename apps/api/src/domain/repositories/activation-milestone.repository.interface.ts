import type { ActivationMilestone } from '@repo/validation';
import type { ChapterActivationMilestone } from '../entities/chapter-activation-milestone.entity';

export const ACTIVATION_MILESTONE_REPOSITORY =
  'ACTIVATION_MILESTONE_REPOSITORY';

export interface IActivationMilestoneRepository {
  /**
   * Record `milestone` for `chapterId` if it has never been recorded before.
   *
   * Returns `true` only when this call is the one that created the row — i.e.
   * this is genuinely the chapter's *first* time reaching the milestone. A
   * conflicting insert returns `false` rather than throwing, because reaching a
   * milestone twice is the normal case (every invite after the first, every
   * message after the first), not an error.
   *
   * Implementations must make this atomic: two concurrent first-invites must
   * not both come back `true`, or the funnel double-counts.
   */
  recordFirst(
    chapterId: string,
    milestone: ActivationMilestone,
  ): Promise<boolean>;

  /** Every milestone a chapter has reached, oldest first. */
  findByChapter(chapterId: string): Promise<ChapterActivationMilestone[]>;
}
