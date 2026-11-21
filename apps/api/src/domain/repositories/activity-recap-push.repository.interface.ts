export const ACTIVITY_RECAP_PUSH_REPOSITORY = 'ACTIVITY_RECAP_PUSH_REPOSITORY';

/** The once-a-week claims behind the recap push (#4985, `activity_recap_pushes`). */
export interface IActivityRecapPushRepository {
  /**
   * Claims the member's push for the chapter and the week that began on
   * `weekFirstDay`. True when this call made the claim, false when one
   * already existed: only the caller that gets true sends, on any replica.
   */
  claim(
    chapterId: string,
    userId: string,
    weekFirstDay: string,
  ): Promise<boolean>;
  /** Gives a claim back, for a push that failed, so the next sweep tries again. */
  release(
    chapterId: string,
    userId: string,
    weekFirstDay: string,
  ): Promise<void>;
}
