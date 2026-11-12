import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import { AI_CONSENT_SHEET } from '#domain/constants/ai-consent-sheet';
import type {
  ChapterAiSettings,
  UserAiConsent,
} from '#domain/entities/ai-consent.entity';
import type {
  ChapterAiSettingsPatch,
  IAiConsentRepository,
} from '#domain/repositories/ai-consent.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import type { ChapterAuditLogService } from '../chapter-audit-log.service';
import { AiConsentService } from './ai-consent.service';

const CHAPTER = 'chapter-1';
const OTHER_CHAPTER = 'chapter-2';
const PRESIDENT_ROLE = 'role-president';
const MEMBER = 'user-member';
const PRESIDENT = 'user-president';
const CURRENT: number = AI_CONSENT_SHEET.version;

/** The two tables, in memory, as the repository contract describes them. */
class FakeAiConsentRepository implements IAiConsentRepository {
  settings = new Map<string, ChapterAiSettings>();
  consents = new Map<string, UserAiConsent>();

  findChapterSettings(chapterId: string) {
    return Promise.resolve(this.settings.get(chapterId) ?? null);
  }

  saveChapterSettings(
    chapterId: string,
    patch: ChapterAiSettingsPatch,
    updatedBy: string,
    now: Date,
  ) {
    const row: ChapterAiSettings = {
      chapter_id: chapterId,
      ask_enabled: false,
      meeting_notes_enabled: false,
      chat_source_enabled: false,
      ...this.settings.get(chapterId),
      ...patch,
      updated_by: updatedBy,
      updated_at: now.toISOString(),
    };
    this.settings.set(chapterId, row);
    return Promise.resolve(row);
  }

  findConsent(userId: string, sheetVersion: number) {
    return Promise.resolve(
      this.consents.get(`${userId}:${sheetVersion}`) ?? null,
    );
  }

  findLatestConsent(userId: string) {
    const rows = [...this.consents.values()]
      .filter((row) => row.user_id === userId)
      .sort((a, b) => b.sheet_version - a.sheet_version);
    return Promise.resolve(rows[0] ?? null);
  }

  saveConsent(
    userId: string,
    sheetVersion: number,
    accepted: boolean,
    now: Date,
  ) {
    const row: UserAiConsent = {
      user_id: userId,
      sheet_version: sheetVersion,
      accepted,
      answered_at: now.toISOString(),
    };
    this.consents.set(`${userId}:${sheetVersion}`, row);
    return Promise.resolve(row);
  }

  findAcceptedUserIds(userIds: readonly string[], sheetVersion: number) {
    return Promise.resolve(
      userIds.filter(
        (id) => this.consents.get(`${id}:${sheetVersion}`)?.accepted === true,
      ),
    );
  }
}

const call = (overrides: Partial<AiCallDescriptor> = {}): AiCallDescriptor => ({
  chapterId: CHAPTER,
  actingUserId: MEMBER,
  task: 'ask.answer',
  family: 'ask',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  promptVersion: 'ask@v1',
  ...overrides,
});

describe('AiConsentService', () => {
  let repo: FakeAiConsentRepository;
  let record: jest.Mock;
  let service: AiConsentService;

  const turnOn = (chapterId: string, patch: ChapterAiSettingsPatch) =>
    repo.saveChapterSettings(chapterId, patch, PRESIDENT, new Date());
  const sayYes = (userId: string, version = CURRENT) =>
    repo.saveConsent(userId, version, true, new Date());

  beforeEach(() => {
    repo = new FakeAiConsentRepository();
    record = jest.fn().mockResolvedValue(undefined);
    const roles = {
      findByChapterAndSystemKey: jest.fn((chapterId: string) =>
        Promise.resolve(
          chapterId === CHAPTER ? { id: PRESIDENT_ROLE } : { id: 'elsewhere' },
        ),
      ),
    } as unknown as IRoleRepository;
    service = new AiConsentService(repo, roles, {
      record,
    } as unknown as ChapterAuditLogService);
  });

  describe('check (the gateway seam)', () => {
    it('refuses every family while the chapter has no switch on', async () => {
      await sayYes(MEMBER);
      for (const family of ['ask', 'meetings', 'corpus'] as const) {
        await expect(service.check(call({ family }))).resolves.toEqual({
          allowed: false,
          reason: 'chapter_off',
        });
      }
    });

    it('refuses a member who has not answered, which counts as No', async () => {
      await turnOn(CHAPTER, { ask_enabled: true });
      await expect(service.check(call())).resolves.toEqual({
        allowed: false,
        reason: 'member_declined',
      });
    });

    it('refuses a member who said No', async () => {
      await turnOn(CHAPTER, { ask_enabled: true });
      await repo.saveConsent(MEMBER, CURRENT, false, new Date());
      await expect(service.check(call())).resolves.toEqual({
        allowed: false,
        reason: 'member_declined',
      });
    });

    it('allows a member who said yes, in a chapter with the family on', async () => {
      await turnOn(CHAPTER, { ask_enabled: true });
      await sayYes(MEMBER);
      await expect(service.check(call())).resolves.toEqual({ allowed: true });
    });

    it('treats a Yes on an earlier sheet as no answer', async () => {
      await turnOn(CHAPTER, { ask_enabled: true });
      await sayYes(MEMBER, CURRENT - 1);
      await expect(service.check(call())).resolves.toEqual({
        allowed: false,
        reason: 'member_declined',
      });
    });

    it('puts each family behind its own switch, and embeddings behind Ask', async () => {
      await sayYes(MEMBER);
      await turnOn(CHAPTER, { meeting_notes_enabled: true });
      await expect(
        service.check(call({ family: 'meetings' })),
      ).resolves.toEqual({ allowed: true });
      await expect(service.check(call({ family: 'ask' }))).resolves.toEqual({
        allowed: false,
        reason: 'chapter_off',
      });
      await expect(service.check(call({ family: 'corpus' }))).resolves.toEqual({
        allowed: false,
        reason: 'chapter_off',
      });

      await turnOn(CHAPTER, { ask_enabled: true });
      await expect(service.check(call({ family: 'corpus' }))).resolves.toEqual({
        allowed: true,
      });
    });

    it("reads the call's own chapter, not another chapter the member is in", async () => {
      await sayYes(MEMBER);
      await turnOn(OTHER_CHAPTER, { ask_enabled: true });
      await expect(service.check(call())).resolves.toEqual({
        allowed: false,
        reason: 'chapter_off',
      });
    });

    it('stops at once when the president turns the family off', async () => {
      await sayYes(MEMBER);
      await turnOn(CHAPTER, { ask_enabled: true });
      await expect(service.check(call())).resolves.toEqual({ allowed: true });

      await service.updateChapterSettings(
        CHAPTER,
        { userId: PRESIDENT, roleIds: [PRESIDENT_ROLE] },
        { ask: false },
      );
      await expect(service.check(call())).resolves.toEqual({
        allowed: false,
        reason: 'chapter_off',
      });
    });

    it('stops at once when the member changes their answer to No', async () => {
      await turnOn(CHAPTER, { ask_enabled: true });
      await service.answer(MEMBER, CURRENT, true);
      await expect(service.check(call())).resolves.toEqual({ allowed: true });

      await service.answer(MEMBER, CURRENT, false);
      await expect(service.check(call())).resolves.toEqual({
        allowed: false,
        reason: 'member_declined',
      });
    });
  });

  describe('chatAuthorsWhoSaidYes', () => {
    it('reads nobody while chat as a source is off', async () => {
      await sayYes(MEMBER);
      await turnOn(CHAPTER, { ask_enabled: true });
      await expect(
        service.chatAuthorsWhoSaidYes(CHAPTER, [MEMBER]),
      ).resolves.toEqual(new Set());
    });

    it('reads only the authors who said yes on the current sheet', async () => {
      await turnOn(CHAPTER, { chat_source_enabled: true });
      await sayYes(MEMBER);
      await sayYes('user-old', CURRENT - 1);
      await repo.saveConsent('user-no', CURRENT, false, new Date());
      await expect(
        service.chatAuthorsWhoSaidYes(CHAPTER, [
          MEMBER,
          'user-old',
          'user-no',
          'user-never',
        ]),
      ).resolves.toEqual(new Set([MEMBER]));
    });
  });

  describe('the member sheet', () => {
    it('shows the current sheet, unanswered, to someone who never answered', async () => {
      await expect(service.getConsentState(MEMBER)).resolves.toEqual({
        sheet: AI_CONSENT_SHEET,
        answer: null,
        answered_at: null,
        sheet_changed: false,
      });
    });

    it('records Yes and No on the current version', async () => {
      await expect(
        service.answer(MEMBER, CURRENT, true),
      ).resolves.toMatchObject({ answer: 'yes', sheet_changed: false });
      await expect(
        service.answer(MEMBER, CURRENT, false),
      ).resolves.toMatchObject({ answer: 'no' });
      await expect(service.getConsentState(MEMBER)).resolves.toMatchObject({
        answer: 'no',
      });
    });

    it('asks again, and says the sheet changed, after a new version', async () => {
      await sayYes(MEMBER, CURRENT - 1);
      await expect(service.getConsentState(MEMBER)).resolves.toMatchObject({
        answer: null,
        answered_at: null,
        sheet_changed: true,
      });
    });

    it('tells the registered features each time someone answers No', async () => {
      const withdrawn = jest.fn().mockResolvedValue(undefined);
      service.onConsentWithdrawn(withdrawn);

      await service.answer(MEMBER, CURRENT, true);
      expect(withdrawn).not.toHaveBeenCalled();

      await service.answer(MEMBER, CURRENT, false);
      expect(withdrawn).toHaveBeenCalledWith(MEMBER);
    });

    it('fails the answer when a feature cannot let go, after saving the No', async () => {
      service.onConsentWithdrawn(() =>
        Promise.reject(new Error('scrub failed')),
      );
      await expect(service.answer(MEMBER, CURRENT, false)).rejects.toThrow(
        'scrub failed',
      );
      // The No holds even so: the next call is refused, and a retry runs the
      // listener again.
      await expect(repo.findConsent(MEMBER, CURRENT)).resolves.toMatchObject({
        accepted: false,
      });
    });

    it('refuses an answer to a sheet that is no longer current', async () => {
      const refused = service.answer(MEMBER, CURRENT - 1, true);
      await expect(refused).rejects.toBeInstanceOf(ConflictException);
      await expect(refused).rejects.toMatchObject({
        response: { code: 'ai.consent.stale_sheet' },
      });
      await expect(repo.findLatestConsent(MEMBER)).resolves.toBeNull();
    });
  });

  describe('the chapter switches', () => {
    it('are all off for a chapter that never changed one', async () => {
      await expect(service.getChapterSettings(CHAPTER)).resolves.toEqual({
        ask: false,
        meeting_notes: false,
        chat_source: false,
        updated_at: null,
      });
    });

    it('can be changed by the president only', async () => {
      const refused = service.updateChapterSettings(
        CHAPTER,
        { userId: MEMBER, roleIds: ['role-member'] },
        { ask: true },
      );
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toMatchObject({
        response: { code: 'ai.settings.president_only' },
      });
      await expect(
        service.updateChapterSettings(
          CHAPTER,
          { userId: MEMBER, roleIds: [] },
          { ask: true },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.settings.size).toBe(0);
      expect(record).not.toHaveBeenCalled();
    });

    it("refuses another chapter's president role", async () => {
      await expect(
        service.updateChapterSettings(
          OTHER_CHAPTER,
          { userId: PRESIDENT, roleIds: [PRESIDENT_ROLE] },
          { ask: true },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('writes and audits only the switches that change', async () => {
      await expect(
        service.updateChapterSettings(
          CHAPTER,
          { userId: PRESIDENT, roleIds: [PRESIDENT_ROLE] },
          { ask: true, meeting_notes: false },
        ),
      ).resolves.toMatchObject({
        ask: true,
        meeting_notes: false,
        chat_source: false,
      });
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        actorUserId: PRESIDENT,
        action: 'ai_settings_updated',
        targetType: 'chapter',
        targetId: CHAPTER,
        diff: { ask: { from: false, to: true } },
      });
      expect(repo.settings.get(CHAPTER)).toMatchObject({
        ask_enabled: true,
        updated_by: PRESIDENT,
      });
    });

    it('writes nothing when nothing changes', async () => {
      await turnOn(CHAPTER, { chat_source_enabled: true });
      const before = repo.settings.get(CHAPTER);
      await service.updateChapterSettings(
        CHAPTER,
        { userId: PRESIDENT, roleIds: [PRESIDENT_ROLE] },
        { chat_source: true },
      );
      expect(repo.settings.get(CHAPTER)).toBe(before);
      expect(record).not.toHaveBeenCalled();
    });
  });
});
