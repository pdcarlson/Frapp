export const BIRTHDAY_POST_REPOSITORY = 'BIRTHDAY_POST_REPOSITORY';

/** The once-a-day claims behind the birthday posts (#4959, `birthday_posts`). */
export interface IBirthdayPostRepository {
  /**
   * Claims the chapter's post for this member and local date. True when this
   * call made the claim, false when one already existed: only the caller
   * that gets true posts, on any replica.
   */
  claim(chapterId: string, userId: string, localDate: string): Promise<boolean>;
  /** Gives a claim back, for a post that failed, so the next sweep tries again. */
  release(chapterId: string, userId: string, localDate: string): Promise<void>;
}
