import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { InsertAiReportInput } from '#domain/repositories/ai-report.repository.interface';
import {
  sealAskReportReceipt,
  type AskReportReceipt,
} from '#domain/utils/ai-report-receipt';
import { openAiText, parseAiTextKeyRing } from '#domain/utils/ai-text-cipher';
import { AiReportService, aiReportContext } from './ai-report.service';

const CHAPTER = 'chapter-a';
const REPORTER = 'user-reporter';
const ASK_ID = '00000000-0000-4000-8000-000000000001';
const MEETING = '00000000-0000-4000-8000-000000000002';
const SUGGESTION = '00000000-0000-4000-8000-000000000003';
const NOW = new Date('2026-11-12T18:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const KEY = `k1:${Buffer.alloc(32, 9).toString('base64')}`;
const ring = parseAiTextKeyRing(KEY);

const receipt = (over: Partial<AskReportReceipt> = {}): AskReportReceipt => ({
  v: 1,
  ask_id: ASK_ID,
  issued_at: NOW.toISOString(),
  question: 'When are dues due?',
  written: 'Dues are due on the 1st.',
  shown: {
    status: 'answered',
    reason: null,
    text: 'Dues are due on the 1st.',
    citations: [],
    sources: [],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
  },
  given: [{ title: 'Bylaws', text: 'Dues are due on the 1st.' }],
  tools: [],
  model: 'claude-test',
  prompt_version: 'ask-answer@v1',
  quoted_user_ids: ['dana', REPORTER],
  ...over,
});

const sealed = (r: AskReportReceipt, userId = REPORTER) =>
  sealAskReportReceipt(ring, r, { chapterId: CHAPTER, userId })!;

/** `ai_reports` in memory, with the table's one-per-member rule. */
function fakeRepository() {
  const rows: InsertAiReportInput[] = [];
  return {
    rows,
    insert: jest.fn(async (input: InsertAiReportInput) => {
      if (
        rows.some(
          (row) =>
            row.reportedBy === input.reportedBy &&
            row.subjectType === input.subjectType &&
            row.subjectId === input.subjectId,
        )
      ) {
        return false;
      }
      rows.push(input);
      return true;
    }),
    deleteQuoting: jest.fn(async (userId: string) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].quotedUserIds.includes(userId)) rows.splice(i, 1);
      }
      return before - rows.length;
    }),
    deleteExpired: jest.fn(async (now: Date) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].expiresAt.getTime() <= now.getTime()) rows.splice(i, 1);
      }
      return before - rows.length;
    }),
  };
}

function build(
  options: {
    draft?: unknown;
    suggestion?: unknown;
    saidNo?: string[];
  } = {},
) {
  const reports = fakeRepository();
  const drafts = {
    forReport: jest.fn(async () =>
      options.draft === undefined
        ? {
            requestId: '00000000-0000-4000-8000-0000000000d1',
            notes: 'Voted to move formal to March. Dana books the venue.',
            meetingDate: '2026-11-10',
            status: 'applied',
            result: { review: { gaps: [] } },
            minutesNow: { decisions: 'Formal moves to March.' },
            requestedBy: 'officer-1',
          }
        : options.draft,
    ),
  };
  const suggestions = {
    findVisible: jest.fn(async () =>
      options.suggestion === undefined
        ? {
            id: SUGGESTION,
            kind: 'task',
            status: 'pending',
            source_type: 'meeting',
            source_id: MEETING,
            payload: { title: 'Book the venue' },
            quote: 'Dana books the venue',
            quote_author_id: null,
          }
        : options.suggestion,
    ),
  };
  let withdrawn: ((userId: string) => Promise<void>) | null = null;
  const consent = {
    onConsentWithdrawn: jest.fn((listener: (id: string) => Promise<void>) => {
      withdrawn = listener;
    }),
    getConsentState: jest.fn(async (id: string) => ({
      answer: options.saidNo?.includes(id) ? 'no' : 'yes',
    })),
  };
  const service = new AiReportService(
    reports,
    drafts as never,
    suggestions as never,
    consent as never,
  );
  service.onModuleInit();
  return {
    service,
    reports,
    drafts,
    suggestions,
    withdraw: (id: string) => withdrawn!(id),
  };
}

const base = {
  chapterId: CHAPTER,
  userId: REPORTER,
  enabledModules: null,
  reason: 'wrong' as const,
};

function opened(row: InsertAiReportInput): Record<string, unknown> {
  return JSON.parse(
    openAiText(ring, row.sealed!, aiReportContext(CHAPTER)),
  ) as Record<string, unknown>;
}

describe('AiReportService', () => {
  const savedKey = process.env.AI_STORED_TEXT_KEY;
  beforeEach(() => {
    process.env.AI_STORED_TEXT_KEY = KEY;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.AI_STORED_TEXT_KEY;
    else process.env.AI_STORED_TEXT_KEY = savedKey;
  });

  describe('an Ask answer', () => {
    it('keeps the exchange from the receipt, sealed to the chapter, for 30 days', async () => {
      const { service, reports } = build();
      const outcome = await service.report(
        {
          ...base,
          subject: 'ask_answer',
          subjectId: ASK_ID,
          note: '  The bylaws say the 15th.  ',
          receipt: sealed(receipt()),
        },
        NOW,
      );
      expect(outcome).toEqual({
        already_reported: false,
        kept_text: true,
        expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      });
      const [row] = reports.rows;
      expect(row).toEqual(
        expect.objectContaining({
          subjectType: 'ask_answer',
          subjectId: ASK_ID,
          note: 'The bylaws say the 15th.',
          model: 'claude-test',
          promptVersion: 'ask-answer@v1',
          // The reporter's own words are not "quoted".
          quotedUserIds: ['dana'],
        }),
      );
      expect(row.sealed).not.toContain('dues');
      expect(opened(row)).toEqual(
        expect.objectContaining({
          subject: 'ask_answer',
          question: 'When are dues due?',
          written: 'Dues are due on the 1st.',
          given: [{ title: 'Bylaws', text: 'Dues are due on the 1st.' }],
        }),
      );
      // The receipt's bookkeeping is not part of what the team reads.
      expect(opened(row)).not.toHaveProperty('quoted_user_ids');
    });

    it('keeps only the reason and note when the server holds no key', async () => {
      delete process.env.AI_STORED_TEXT_KEY;
      const { service, reports } = build();
      const outcome = await service.report(
        { ...base, subject: 'ask_answer', subjectId: ASK_ID, note: 'Wrong' },
        NOW,
      );
      expect(outcome.kept_text).toBe(false);
      expect(reports.rows[0]).toEqual(
        expect.objectContaining({
          sealed: null,
          note: 'Wrong',
          quotedUserIds: [],
          model: null,
        }),
      );
      expect(service.keepsText()).toBe(false);
    });

    it('refuses a receipt issued to someone else, or for another answer', async () => {
      const { service, reports } = build();
      await expect(
        service.report(
          {
            ...base,
            subject: 'ask_answer',
            subjectId: ASK_ID,
            receipt: sealed(receipt(), 'another-member'),
          },
          NOW,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.report(
          {
            ...base,
            subject: 'ask_answer',
            subjectId: '00000000-0000-4000-8000-0000000000ff',
            receipt: sealed(receipt()),
          },
          NOW,
        ),
      ).rejects.toMatchObject({
        response: { code: 'ai.report.receipt_invalid' },
      });
      expect(reports.rows).toHaveLength(0);
    });

    it('refuses an answer older than a week', async () => {
      const { service } = build();
      await expect(
        service.report(
          {
            ...base,
            subject: 'ask_answer',
            subjectId: ASK_ID,
            receipt: sealed(receipt()),
          },
          new Date(NOW.getTime() + 8 * DAY),
        ),
      ).rejects.toMatchObject({ response: { code: 'ai.report.too_old' } });
    });

    it('keeps nothing new when the member reports the same answer twice', async () => {
      const { service, reports } = build();
      const input = {
        ...base,
        subject: 'ask_answer' as const,
        subjectId: ASK_ID,
        receipt: sealed(receipt()),
      };
      await service.report(input, NOW);
      const again = await service.report(input, NOW);
      expect(again).toEqual(
        expect.objectContaining({ already_reported: true, kept_text: false }),
      );
      expect(reports.rows).toHaveLength(1);
    });
  });

  describe('a drafted set of minutes', () => {
    it('keeps the notes, the draft and the minutes as they are now, quoting the officer who wrote the notes', async () => {
      const { service, reports, drafts } = build();
      await service.report(
        { ...base, subject: 'meeting_draft', subjectId: MEETING },
        NOW,
      );
      expect(drafts.forReport).toHaveBeenCalledWith(CHAPTER, MEETING, REPORTER);
      const [row] = reports.rows;
      // Named by its request, so a draft asked for again is reported anew.
      expect(row.subjectId).toBe('00000000-0000-4000-8000-0000000000d1');
      expect(row.quotedUserIds).toEqual(['officer-1']);
      expect(row.promptVersion).toBe('minutes-draft@v1');
      expect(opened(row)).toEqual(
        expect.objectContaining({
          meeting_id: MEETING,
          notes: 'Voted to move formal to March. Dana books the venue.',
          minutes_now: { decisions: 'Formal moves to March.' },
        }),
      );
    });

    it('answers 404 when there is no draft to report, even with no key', async () => {
      delete process.env.AI_STORED_TEXT_KEY;
      const { service, reports } = build({ draft: null });
      await expect(
        service.report(
          { ...base, subject: 'meeting_draft', subjectId: MEETING },
          NOW,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(reports.rows).toHaveLength(0);
    });
  });

  describe('a suggestion', () => {
    it('keeps the suggestion and its quote', async () => {
      const { service, reports } = build();
      await service.report(
        { ...base, subject: 'ai_suggestion', subjectId: SUGGESTION },
        NOW,
      );
      expect(opened(reports.rows[0])).toEqual(
        expect.objectContaining({
          suggestion: { title: 'Book the venue' },
          quote: 'Dana books the venue',
        }),
      );
    });

    it('answers 404 for a suggestion the member could not see', async () => {
      const { service } = build({ suggestion: null });
      await expect(
        service.report(
          { ...base, subject: 'ai_suggestion', subjectId: SUGGESTION },
          NOW,
        ),
      ).rejects.toMatchObject({ response: { code: 'ai.report.not_found' } });
    });
  });

  describe('whose words', () => {
    it('a quoted member’s No deletes every report quoting them', async () => {
      const { service, reports, withdraw } = build();
      await service.report(
        {
          ...base,
          subject: 'ask_answer',
          subjectId: ASK_ID,
          receipt: sealed(receipt()),
        },
        NOW,
      );
      await service.report(
        { ...base, subject: 'ai_suggestion', subjectId: SUGGESTION },
        NOW,
      );
      await withdraw('dana');
      expect(reports.rows.map((row) => row.subjectType)).toEqual([
        'ai_suggestion',
      ]);
    });

    it('a quoted member who said No while the report was made is not kept', async () => {
      const { service, reports } = build({ saidNo: ['dana'] });
      await service.report(
        {
          ...base,
          subject: 'ask_answer',
          subjectId: ASK_ID,
          receipt: sealed(receipt()),
        },
        NOW,
      );
      expect(reports.rows).toHaveLength(0);
    });
  });

  describe('the sweep', () => {
    it('keeps a report for 30 days and deletes it then', async () => {
      const { service, reports } = build();
      await service.report(
        {
          ...base,
          subject: 'ask_answer',
          subjectId: ASK_ID,
          receipt: sealed(receipt()),
        },
        NOW,
      );
      await expect(
        service.sweep(new Date(NOW.getTime() + 30 * DAY - 1)),
      ).resolves.toBe(0);
      expect(reports.rows).toHaveLength(1);
      await expect(
        service.sweep(new Date(NOW.getTime() + 30 * DAY)),
      ).resolves.toBe(1);
      expect(reports.rows).toHaveLength(0);
    });
  });
});
