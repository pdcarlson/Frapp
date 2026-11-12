import type {
  ChapterAiSettings,
  UserAiConsent,
} from '../entities/ai-consent.entity';

export const AI_CONSENT_REPOSITORY = 'AI_CONSENT_REPOSITORY';

/** The switch columns of `chapter_ai_settings`, any of which a write sets. */
export type ChapterAiSettingsPatch = Partial<
  Pick<
    ChapterAiSettings,
    'ask_enabled' | 'meeting_notes_enabled' | 'chat_source_enabled'
  >
>;

/**
 * Storage for the two consent gates (#4308): the chapter's switches and each
 * person's answers on the AI sheet. Reads are never cached, so a switch
 * turned off or an answer changed holds from the next call.
 */
export interface IAiConsentRepository {
  /** The chapter's switches, or null when no switch was ever changed. */
  findChapterSettings(chapterId: string): Promise<ChapterAiSettings | null>;

  /**
   * Writes the given switches for the chapter, creating its row on the
   * first change, and returns the row as stored.
   */
  saveChapterSettings(
    chapterId: string,
    patch: ChapterAiSettingsPatch,
    updatedBy: string,
    now: Date,
  ): Promise<ChapterAiSettings>;

  /**
   * Every chapter with this switch on. For a scheduled feature that visits
   * each such chapter (#3930); nothing a member's request reads.
   */
  listChapterIdsWithSwitchOn(
    column: keyof ChapterAiSettingsPatch,
  ): Promise<string[]>;

  /** The person's answer on this sheet version, or null if they gave none. */
  findConsent(
    userId: string,
    sheetVersion: number,
  ): Promise<UserAiConsent | null>;

  /** The person's most recent answer on any version, or null. */
  findLatestConsent(userId: string): Promise<UserAiConsent | null>;

  /** Records the person's answer on this version, replacing an earlier one. */
  saveConsent(
    userId: string,
    sheetVersion: number,
    accepted: boolean,
    now: Date,
  ): Promise<UserAiConsent>;

  /** Of `userIds`, the ones whose answer on this version is Yes. */
  findAcceptedUserIds(
    userIds: readonly string[],
    sheetVersion: number,
  ): Promise<string[]>;
}
