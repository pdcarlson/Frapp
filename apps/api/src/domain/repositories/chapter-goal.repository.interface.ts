import type {
  ChapterGoalRow,
  GoalMetric,
  GoalSet,
} from '../entities/chapter-goal.entity';

export const CHAPTER_GOAL_REPOSITORY = 'CHAPTER_GOAL_REPOSITORY';

export interface IChapterGoalRepository {
  /** The chapter's stored goal rows; a measure with no row has no goals. */
  findByChapter(chapterId: string): Promise<ChapterGoalRow[]>;
  /** Replace one measure's goals in a single write. */
  upsert(
    chapterId: string,
    metric: GoalMetric,
    goals: GoalSet,
    updatedBy: string,
  ): Promise<ChapterGoalRow>;
}
