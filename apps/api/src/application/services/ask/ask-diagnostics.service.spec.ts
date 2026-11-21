import { randomBytes } from 'node:crypto';
import { openAiText, parseAiTextKeyRing } from '#domain/utils/ai-text-cipher';
import { reportSwallowed } from '../../../infrastructure/observability/report-swallowed';
import {
  AskDiagnosticsService,
  askDiagnosticsContext,
  type AskDiagnosticsRecord,
} from './ask-diagnostics.service';

jest.mock('../../../infrastructure/observability/report-swallowed', () => ({
  reportSwallowed: jest.fn(),
}));

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const KEY = `beta1:${randomBytes(32).toString('base64')}`;
const NOW = new Date('2026-11-12T18:00:00.000Z');
const ENDS = '2026-11-26T18:00:00.000Z';
const PRESIDENT = { userId: 'president', roleIds: ['role-president'] };
const MEMBER = { userId: 'member', roleIds: ['role-member'] };

const record: AskDiagnosticsRecord = {
  question: 'What is quorum?',
  status: 'answered',
  answer: 'Two thirds.',
  sources: [{ kind: 'document', title: 'Bylaws', detail: null }],
  tools: [],
  model: 'model',
  prompt_version: 'ask.answer@v1',
  unverified_citations: 0,
};

function build() {
  let window: {
    id: string;
    chapter_id: string;
    started_by: string;
    started_at: string;
    ends_at: string;
  } | null = null;
  const store = {
    findWindow: jest.fn(async (chapterId: string) =>
      window?.chapter_id === chapterId ? window : null,
    ),
    openWindow: jest.fn(
      async (input: {
        chapterId: string;
        startedBy: string;
        startedAt: Date;
        endsAt: Date;
      }) => {
        if (window) return null;
        window = {
          id: 'window-1',
          chapter_id: input.chapterId,
          started_by: input.startedBy,
          started_at: input.startedAt.toISOString(),
          ends_at: input.endsAt.toISOString(),
        };
        return window;
      },
    ),
    deleteWindow: jest.fn(async () => {
      const had = window !== null;
      window = null;
      return had;
    }),
    insertExchange: jest.fn(async (_input: { sealed: string }) => true),
    deleteExchangesByUser: jest.fn(async () => 1),
    deleteExpiredWindows: jest.fn(async () => 0),
  };
  const roles = {
    findByChapterAndSystemKey: jest.fn(async () => ({ id: 'role-president' })),
  };
  const members = {
    findByUserAndChapter: jest.fn(async () => ({ id: 'member-row' })),
  };
  const withdrawn: Array<(userId: string) => Promise<void>> = [];
  const consent = {
    onConsentWithdrawn: jest.fn((fn: (userId: string) => Promise<void>) => {
      withdrawn.push(fn);
    }),
    getConsentState: jest.fn(async () => ({ answer: 'yes' as 'yes' | 'no' })),
  };
  const auditLog = { record: jest.fn(async () => undefined) };
  const service = new AskDiagnosticsService(
    store,
    roles as never,
    members as never,
    consent as never,
    auditLog as never,
  );
  return { service, store, roles, members, consent, auditLog, withdrawn };
}

describe('AskDiagnosticsService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.AI_STORED_TEXT_KEY = KEY;
    process.env.AI_DIAGNOSTICS_CHAPTER_ID = CHAPTER;
    jest.mocked(reportSwallowed).mockClear();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  describe('who is offered it', () => {
    it('is offered to nobody when the server names no chapter', async () => {
      delete process.env.AI_DIAGNOSTICS_CHAPTER_ID;
      const { service } = build();
      await expect(
        service.view(CHAPTER, PRESIDENT.roleIds, NOW),
      ).resolves.toEqual({ offered: false, can_change: false, ends_at: null });
      await expect(
        service.start(CHAPTER, PRESIDENT, NOW),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.not_offered',
        }),
      });
    });

    it('is offered to nobody when the server holds no key', async () => {
      delete process.env.AI_STORED_TEXT_KEY;
      const { service } = build();
      await expect(
        service.view(CHAPTER, PRESIDENT.roleIds, NOW),
      ).resolves.toEqual({ offered: false, can_change: false, ends_at: null });
    });

    it('is not offered to any other chapter', async () => {
      const { service, store } = build();
      await expect(service.start(OTHER, PRESIDENT, NOW)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.not_offered',
        }),
      });
      await expect(service.keep(OTHER, 'member', record, NOW)).resolves.toBe(
        false,
      );
      expect(store.openWindow).not.toHaveBeenCalled();
      expect(store.insertExchange).not.toHaveBeenCalled();
    });
  });

  describe('the president’s yes', () => {
    it('opens a window that ends exactly 14 days later, and records who agreed', async () => {
      const { service, auditLog } = build();
      await expect(service.start(CHAPTER, PRESIDENT, NOW)).resolves.toEqual({
        offered: true,
        can_change: true,
        ends_at: ENDS,
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER,
          actorUserId: 'president',
          action: 'ai_diagnostics_started',
          diff: { ends_at: ENDS },
        }),
      );
    });

    it('refuses anyone who is not the president', async () => {
      const { service, store } = build();
      await expect(service.start(CHAPTER, MEMBER, NOW)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.president_only',
        }),
      });
      await expect(service.stop(CHAPTER, MEMBER)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.president_only',
        }),
      });
      expect(store.openWindow).not.toHaveBeenCalled();
      expect(store.deleteWindow).not.toHaveBeenCalled();
    });

    it('refuses a second yes while one is on: nothing extends the end date', async () => {
      const { service } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      await expect(
        service.start(CHAPTER, PRESIDENT, new Date('2026-11-20T00:00:00.000Z')),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.already_on',
        }),
      });
      await expect(
        service.view(CHAPTER, PRESIDENT.roleIds, NOW),
      ).resolves.toEqual(expect.objectContaining({ ends_at: ENDS }));
    });

    it('opens no window it could not record in the audit log', async () => {
      const { service, auditLog, store } = build();
      auditLog.record.mockRejectedValueOnce(new Error('audit down'));
      await expect(service.start(CHAPTER, PRESIDENT, NOW)).rejects.toThrow(
        'audit down',
      );
      expect(store.deleteWindow).toHaveBeenCalledWith(CHAPTER);
      await expect(service.openWindow(CHAPTER, NOW)).resolves.toBeNull();
    });

    it('turning it off deletes the window and records it; turning off nothing records nothing', async () => {
      const { service, auditLog } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      await expect(service.stop(CHAPTER, PRESIDENT)).resolves.toEqual({
        offered: true,
        can_change: true,
        ends_at: null,
      });
      expect(auditLog.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'ai_diagnostics_stopped' }),
      );
      auditLog.record.mockClear();
      await service.stop(CHAPTER, PRESIDENT);
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('can still be turned off after the server stops offering it, and by nobody else', async () => {
      const { service, store, auditLog } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      // The window is open and the setting has since been unset or moved.
      delete process.env.AI_DIAGNOSTICS_CHAPTER_ID;
      await expect(service.stop(CHAPTER, MEMBER)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.president_only',
        }),
      });
      await expect(service.stop(CHAPTER, PRESIDENT)).resolves.toEqual({
        offered: false,
        can_change: true,
        ends_at: null,
      });
      expect(store.deleteWindow).toHaveBeenCalledWith(CHAPTER);
      expect(auditLog.record).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'ai_diagnostics_stopped' }),
      );
      // With nothing left to stop it is the route that does not exist again.
      await expect(service.stop(CHAPTER, PRESIDENT)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ai.ask.diagnostics.not_offered',
        }),
      });
    });

    it('deletes nothing it could not record in the audit log', async () => {
      const { service, store, auditLog } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      auditLog.record.mockRejectedValueOnce(new Error('audit down'));
      await expect(service.stop(CHAPTER, PRESIDENT)).rejects.toThrow(
        'audit down',
      );
      expect(store.deleteWindow).not.toHaveBeenCalled();
      await expect(service.openWindow(CHAPTER, NOW)).resolves.not.toBeNull();
    });
  });

  describe('what a member sees', () => {
    it('tells every member when the window ends, and only the president that they can change it', async () => {
      const { service } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      await expect(service.view(CHAPTER, MEMBER.roleIds, NOW)).resolves.toEqual(
        {
          offered: true,
          can_change: false,
          ends_at: ENDS,
        },
      );
    });
  });

  describe('keeping an exchange', () => {
    it('keeps nothing while no window is open', async () => {
      const { service, store } = build();
      await expect(service.keep(CHAPTER, 'member', record, NOW)).resolves.toBe(
        false,
      );
      expect(store.insertExchange).not.toHaveBeenCalled();
    });

    it('seals the exchange so it opens only with the key, as this chapter’s', async () => {
      const { service, store } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      await expect(service.keep(CHAPTER, 'member', record, NOW)).resolves.toBe(
        true,
      );
      const [written] = store.insertExchange.mock.calls[0];
      expect(written).toEqual(
        expect.objectContaining({
          chapterId: CHAPTER,
          windowId: 'window-1',
          memberId: 'member-row',
          userId: 'member',
        }),
      );
      expect(written.sealed).not.toContain('quorum');
      const ring = parseAiTextKeyRing(KEY)!;
      expect(
        JSON.parse(
          openAiText(ring, written.sealed, askDiagnosticsContext(CHAPTER)),
        ),
      ).toEqual(record);
      expect(() =>
        openAiText(ring, written.sealed, askDiagnosticsContext(OTHER)),
      ).toThrow();
    });

    it('takes the exchange back out when the member said No while it was being answered', async () => {
      const { service, store, consent } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      consent.getConsentState.mockResolvedValueOnce({ answer: 'no' });
      await expect(service.keep(CHAPTER, 'member', record, NOW)).resolves.toBe(
        false,
      );
      expect(store.deleteExchangesByUser).toHaveBeenCalledWith('member');
    });

    it('keeps nothing once the end date has passed, even before the sweep runs', async () => {
      const { service, store } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      await expect(
        service.keep(CHAPTER, 'member', record, new Date(ENDS)),
      ).resolves.toBe(false);
      expect(store.insertExchange).not.toHaveBeenCalled();
    });

    it('keeps nothing for someone who is no longer a member', async () => {
      const { service, members, store } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      members.findByUserAndChapter.mockResolvedValueOnce(null as never);
      await expect(service.keep(CHAPTER, 'gone', record, NOW)).resolves.toBe(
        false,
      );
      expect(store.insertExchange).not.toHaveBeenCalled();
    });

    it('never fails the answer when keeping fails, and reports it without the text', async () => {
      const { service, store } = build();
      await service.start(CHAPTER, PRESIDENT, NOW);
      store.insertExchange.mockRejectedValueOnce(new Error('database down'));
      await expect(service.keep(CHAPTER, 'member', record, NOW)).resolves.toBe(
        false,
      );
      expect(reportSwallowed).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(jest.mocked(reportSwallowed).mock.calls),
      ).not.toContain('quorum');
    });
  });

  describe('deleting', () => {
    it('a No on the AI sheet deletes what the person asked', async () => {
      const { service, store, withdrawn } = build();
      service.onModuleInit();
      expect(withdrawn).toHaveLength(1);
      await withdrawn[0]('member');
      expect(store.deleteExchangesByUser).toHaveBeenCalledWith('member');
    });

    it('the sweep deletes whatever has run out', async () => {
      const { service, store } = build();
      store.deleteExpiredWindows.mockResolvedValueOnce(1);
      await expect(service.sweep(NOW)).resolves.toBe(1);
      expect(store.deleteExpiredWindows).toHaveBeenCalledWith(NOW);
    });
  });
});
