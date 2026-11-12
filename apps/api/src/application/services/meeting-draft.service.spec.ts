import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DEFAULT_MEETING_SECTIONS,
  MEETING_NOTES_MAX_LENGTH,
  type MeetingDraftOutput,
} from '@repo/validation';
import type {
  IMeetingDraftRepository,
  MeetingDraftOutcome,
  NewMeetingDraft,
} from '#domain/repositories/meeting-draft.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting, MeetingDraft } from '#domain/entities/meeting.entity';
import type { AiRun } from '#domain/entities/ai-run.entity';
import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import type { IAiConsentCheck } from '#domain/adapters/ai-consent-check.interface';
import type { IAiSpendReservation } from '#domain/adapters/ai-spend-reservation.interface';
import {
  ScriptedLanguageModel,
  type ScriptedReply,
} from '../../infrastructure/ai/scripted-language-model';
import { AiGatewayService } from './ai/ai-gateway.service';
import type { AiConsentService } from './ai/ai-consent.service';
import { AiRunFailure, AiRunRegistry } from './ai-run-registry';
import type { AiRunService, AiRunView } from './ai-run.service';
import { MeetingDraftService } from './meeting-draft.service';
import type { MeetingService } from './meeting.service';
import type { RbacService } from './rbac.service';

const CHAPTER = 'ch-1';
const MEETING = '0a000000-0000-4000-8000-000000000001';
const SECRETARY = '0a000000-0000-4000-8000-00000000000a';
const PRIYA = '0a000000-0000-4000-8000-00000000000b';
const RUN = '0a000000-0000-4000-8000-0000000000f1';
const V1 = '2026-11-10T02:00:00.000000+00:00';

const NOTES = [
  'formal: motion to spend up to $1,200 on a DJ. passed 22-5',
  'Priya will email the 6 by Wednesday',
  'someone needs to send the thank-you email',
].join('\n');

const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: MEETING,
  chapter_id: CHAPTER,
  event_id: 'evt-1',
  event_name: 'Chapter meeting',
  event_start_time: '2026-11-10T00:00:00.000Z',
  meeting_type: 'chapter',
  other_label: null,
  status: 'draft',
  content: {},
  created_by: SECRETARY,
  updated_by: SECRETARY,
  posted_by: null,
  posted_at: null,
  created_at: V1,
  updated_at: V1,
  ...overrides,
});

const DRAFTED: MeetingDraftOutput = {
  summary: 'The chapter approved a DJ for formal.',
  announcements: '',
  decisions: [
    {
      text: 'Approved up to $1,200 for a DJ at formal.',
      vote: { for: 22, against: 5, abstain: 0 },
      quote: 'formal: motion to spend up to $1,200 on a DJ. passed 22-5',
    },
    // Not in the notes: Frapp's check drops it.
    { text: 'Raised dues by $50.', vote: null, quote: 'dues go up $50' },
  ],
  action_items: [
    {
      text: 'Email the six members who have not paid.',
      owner: 'Priya Natarajan',
      due_date: '2026-11-11',
      quote: 'Priya will email the 6 by Wednesday',
    },
    {
      text: 'Send the thank-you email.',
      owner: 'Priya Natarajan',
      due_date: null,
      quote: 'someone needs to send the thank-you email',
    },
  ],
  officer_reports: '',
  old_business: '',
  new_business: '',
  discussion_log: '',
  open_questions: ['The notes don’t say who sends the thank-you email.'],
};

/** `meeting_drafts`, in memory, with the repository's own conditions. */
class FakeDrafts implements IMeetingDraftRepository {
  row: MeetingDraft | null = null;

  find(): Promise<MeetingDraft | null> {
    return Promise.resolve(this.row ? { ...this.row } : null);
  }
  replace(data: NewMeetingDraft): Promise<MeetingDraft> {
    this.row = {
      ...data,
      run_id: null,
      status: 'drafting',
      failure_code: null,
      result: null,
      requested_at: '2026-11-10T02:05:00.000Z',
      finished_at: null,
    };
    return Promise.resolve({ ...this.row });
  }
  setRun(_c: string, _m: string, requestId: string, runId: string) {
    if (this.row?.request_id === requestId) this.row.run_id = runId;
    return Promise.resolve();
  }
  finish(
    _c: string,
    _m: string,
    requestId: string,
    from: readonly string[],
    outcome: MeetingDraftOutcome,
  ): Promise<MeetingDraft | null> {
    if (
      !this.row ||
      this.row.request_id !== requestId ||
      !from.includes(this.row.status)
    ) {
      return Promise.resolve(null);
    }
    this.row = {
      ...this.row,
      status: outcome.status,
      ...(outcome.failure_code === undefined
        ? {}
        : { failure_code: outcome.failure_code }),
      ...(outcome.result === undefined ? {} : { result: outcome.result }),
    };
    return Promise.resolve({ ...this.row });
  }
  delete(): Promise<void> {
    this.row = null;
    return Promise.resolve();
  }
  deleteRequestedBefore = jest.fn().mockResolvedValue(2);
}

interface Setup {
  reply?: ScriptedReply;
  consent?: Awaited<ReturnType<IAiConsentCheck['check']>>;
  spend?: Awaited<ReturnType<IAiSpendReservation['reserve']>>;
  stored?: Meeting;
  /** What the caller holds, for "Report this" (default: may record minutes). */
  permissions?: string[];
}

function setup(options: Setup = {}) {
  const drafts = new FakeDrafts();
  const seen: LanguageModelRequest[] = [];
  const model = new ScriptedLanguageModel({
    'minutes.draft': (request) => {
      seen.push(request);
      return (
        options.reply ?? { text: JSON.stringify(DRAFTED), object: DRAFTED }
      );
    },
  });
  const consent: IAiConsentCheck = {
    check: jest.fn().mockResolvedValue(options.consent ?? { allowed: true }),
  };
  // The eval gateway's seams allow everything; this one is given the consent
  // and spend answers under test.
  const gateway = new AiGatewayService(
    { resolve: () => model },
    consent,
    {
      reserve: () =>
        Promise.resolve(
          options.spend ?? { granted: true, reservationId: null },
        ),
    },
    { record: () => Promise.resolve() },
    { inSpan: (_call, run) => run(), callFinished: () => Promise.resolve() },
  );

  const stored = options.stored ?? meeting();
  const meetings = {
    editableBy: jest.fn().mockResolvedValue(stored),
    getTemplate: jest.fn().mockResolvedValue([...DEFAULT_MEETING_SECTIONS]),
    update: jest.fn().mockResolvedValue({}),
  };
  const runs = {
    enqueue: jest.fn().mockResolvedValue({ id: RUN }),
    cancel: jest.fn().mockResolvedValue(true),
    getForMember: jest.fn().mockResolvedValue({ status: 'running' }),
  };
  const registry = new AiRunRegistry();
  const service = new MeetingDraftService(
    drafts,
    {
      findByEvent: jest
        .fn()
        .mockResolvedValue([{ user_id: PRIYA, status: 'PRESENT' }]),
    } as unknown as IAttendanceRepository,
    {
      findChapterMemberIdentities: jest.fn().mockResolvedValue([
        { user_id: PRIYA, display_name: 'Priya Natarajan', role_ids: ['r-t'] },
        { user_id: SECRETARY, display_name: 'Eli Sorensen', role_ids: [] },
      ]),
    } as unknown as IMemberRepository,
    meetings as unknown as MeetingService,
    {
      findByChapter: jest
        .fn()
        .mockResolvedValue([{ id: 'r-t', name: 'Treasurer' }]),
      getEffectivePermissions: jest
        .fn()
        .mockResolvedValue(options.permissions ?? ['meetings:record']),
    } as unknown as RbacService,
    runs as unknown as AiRunService,
    registry,
    gateway,
    consent as unknown as AiConsentService,
  );

  const ask = (notes = NOTES, expected = V1) =>
    service.request(CHAPTER, MEETING, SECRETARY, {
      notes,
      expected_updated_at: expected,
      meeting_date: '2026-11-09',
    });
  const work = () =>
    service.run({
      run: {
        id: RUN,
        chapter_id: CHAPTER,
        kind: 'minutes_draft',
        requested_by: SECRETARY,
        acting_user_id: SECRETARY,
        attempt_count: 1,
        max_attempts: 2,
      },
      input: {
        meeting_id: MEETING,
        request_id: drafts.row?.request_id ?? 'gone',
      },
      signal: new AbortController().signal,
    });
  return {
    service,
    drafts,
    meetings,
    runs,
    registry,
    consent,
    seen,
    ask,
    work,
  };
}

describe('MeetingDraftService', () => {
  const previous = process.env.AI_ENABLED;
  beforeAll(() => {
    process.env.AI_ENABLED = 'true';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = previous;
  });

  it('registers the minutes_draft run kind, acting for the officer', () => {
    const { service, registry } = setup();
    service.onModuleInit();
    expect(registry.get('minutes_draft')).toBe(service);
    expect(service.actsForMember).toBe(true);
    expect(service.runPermissions).toContain('meetings:record');
  });

  describe('asking for a draft', () => {
    it('stores the notes and queues one run for the request', async () => {
      const { ask, drafts, runs } = setup();
      const state = await ask(`  ${NOTES}\n`);

      expect(state.status).toBe('drafting');
      expect(state.notes).toBe(NOTES);
      expect(drafts.row).toMatchObject({
        notes: NOTES,
        requested_by: SECRETARY,
        base_updated_at: V1,
        meeting_date: '2026-11-09',
        run_id: RUN,
      });
      const [queued] = runs.enqueue.mock.calls[0];
      expect(queued).toMatchObject({
        kind: 'minutes_draft',
        actingUserId: SECRETARY,
        dedupeKey: `meeting:${MEETING}:${drafts.row?.request_id}`,
      });
      // Ids only: the notes never ride on the run.
      expect(JSON.stringify(queued)).not.toContain('DJ');
    });

    it('refuses a Standards meeting before any text is stored or sent', async () => {
      const { ask, drafts, runs, seen, consent } = setup({
        stored: meeting({ meeting_type: 'standards' as never }),
      });
      await expect(ask()).rejects.toMatchObject({
        response: { code: 'meeting.standards_refused' },
      });
      expect(drafts.row).toBeNull();
      expect(runs.enqueue).not.toHaveBeenCalled();
      expect(consent.check).not.toHaveBeenCalled();
      expect(seen).toHaveLength(0);
    });

    it('refuses posted minutes', async () => {
      const { ask, drafts } = setup({
        stored: meeting({ status: 'posted', posted_at: V1 }),
      });
      await expect(ask()).rejects.toMatchObject({
        response: { code: 'meeting.draft_posted' },
      });
      expect(drafts.row).toBeNull();
    });

    it('refuses someone who may not edit the minutes, as a save would', async () => {
      const { ask, meetings, drafts } = setup();
      meetings.editableBy.mockRejectedValue(new NotFoundException());
      await expect(ask()).rejects.toBeInstanceOf(NotFoundException);
      expect(drafts.row).toBeNull();
    });

    it('refuses empty notes and notes past the limit', async () => {
      const { ask } = setup();
      await expect(ask('   ')).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        ask('x'.repeat(MEETING_NOTES_MAX_LENGTH + 1)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a draft over minutes someone saved since', async () => {
      const { ask, drafts } = setup();
      await expect(
        ask(NOTES, '2026-11-10T01:00:00.000000+00:00'),
      ).rejects.toMatchObject({ response: { code: 'meeting.stale' } });
      expect(drafts.row).toBeNull();
    });

    it('says the chapter has it off, storing nothing', async () => {
      const { ask, drafts, runs } = setup({
        consent: { allowed: false, reason: 'chapter_off' },
      });
      await expect(ask()).rejects.toMatchObject({
        response: { code: 'ai.chapter_off' },
      });
      expect(drafts.row).toBeNull();
      expect(runs.enqueue).not.toHaveBeenCalled();
    });

    it('says the officer has not agreed yet, storing nothing', async () => {
      const { ask, drafts } = setup({
        consent: { allowed: false, reason: 'member_declined' },
      });
      const refusal = await ask().catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal).toMatchObject({
        response: { code: 'ai.consent.required' },
      });
      expect(drafts.row).toBeNull();
    });

    it('asking again stops the earlier run and replaces its notes', async () => {
      const { ask, drafts, runs } = setup();
      await ask();
      const first = drafts.row?.request_id;
      await ask('new notes');
      expect(runs.cancel).toHaveBeenCalledWith(CHAPTER, RUN);
      expect(drafts.row?.notes).toBe('new notes');
      expect(drafts.row?.request_id).not.toBe(first);
    });

    it('keeps the notes and reads as failed when the run cannot be queued', async () => {
      const { ask, drafts, runs } = setup();
      runs.enqueue.mockRejectedValue(new Error('queue down'));
      await expect(ask()).rejects.toThrow('queue down');
      expect(drafts.row).toMatchObject({
        notes: NOTES,
        status: 'failed',
        failure_code: 'unavailable',
      });
    });
  });

  describe('the run', () => {
    it('puts the checked draft into the minutes the officer asked on', async () => {
      const { ask, work, meetings, drafts, seen } = setup();
      await ask();
      const result = await work();

      expect(seen).toHaveLength(1);
      expect(seen[0].messages[0].content).toContain(
        'Priya Natarajan (Treasurer) *',
      );
      expect(seen[0].messages[0].content).toContain('Date: Monday, 2026-11-09');

      const [, , actor, save] = meetings.update.mock.calls[0];
      expect(actor).toBe(SECRETARY);
      expect(save.expected_updated_at).toBe(V1);
      expect(save.content).toEqual({
        summary: 'The chapter approved a DJ for formal.',
        announcements: '',
        decisions: [
          {
            text: 'Approved up to $1,200 for a DJ at formal.',
            vote: { for: 22, against: 5, abstain: 0 },
          },
        ],
        action_items: [
          {
            text: 'Email the six members who have not paid.',
            owner_user_id: PRIYA,
            due_date: '2026-11-11',
          },
          // Named by the model, by nobody in the notes: left for the officer.
          {
            text: 'Send the thank-you email.',
            owner_user_id: null,
            due_date: null,
          },
        ],
      });
      expect(drafts.row?.status).toBe('applied');
      expect(result).toEqual({
        meeting_id: MEETING,
        applied: true,
        decision_count: 1,
        action_item_count: 2,
        left_out_count: 1,
      });
    });

    it('tells the editor what to check the draft against', async () => {
      const { ask, work, service } = setup();
      await ask();
      await work();
      const state = await service.state(CHAPTER, MEETING, SECRETARY);
      expect(state.status).toBe('applied');
      expect(state.content).toBeNull();
      expect(state.review.left_out).toBe(1);
      expect(state.review.gaps).toEqual([
        'The notes don’t say who sends the thank-you email.',
      ]);
      expect(state.review.sources).toContainEqual({
        kind: 'action_item',
        text: 'Email the six members who have not paid.',
        quote: 'Priya will email the 6 by Wednesday',
      });
    });

    it('never overwrites a save made while it was writing: the draft waits', async () => {
      const { ask, work, meetings, service } = setup();
      await ask();
      meetings.update.mockRejectedValue(
        new ConflictException({ code: 'meeting.stale' }),
      );
      const result = await work();
      expect(result).toMatchObject({ applied: false });
      const state = await service.state(CHAPTER, MEETING, SECRETARY);
      expect(state.status).toBe('ready');
      expect(state.content?.decisions).toHaveLength(1);
      expect(state.content).not.toHaveProperty('discussion_log');
    });

    it('writes nothing for a request the officer replaced or cleared', async () => {
      const { ask, work, service, meetings, seen } = setup();
      await ask();
      await service.discard(CHAPTER, MEETING, SECRETARY);
      await expect(work()).resolves.toBeUndefined();
      expect(seen).toHaveLength(0);
      expect(meetings.update).not.toHaveBeenCalled();
    });

    it('asks the minutes to take the draft at the version it was asked on, whatever they are at now', async () => {
      const { ask, work, meetings } = setup();
      await ask();
      // Someone saved while the draft was written: the stored minutes moved.
      meetings.editableBy.mockResolvedValue(
        meeting({ updated_at: '2026-11-10T03:00:00.000Z' }),
      );
      await work();
      expect(meetings.update.mock.calls[0][3].expected_updated_at).toBe(V1);
    });

    it('writes nothing when the officer stops or asks again while the model is answering', async () => {
      const { ask, work, service, meetings, drafts } = setup();
      await ask();
      // The model call is the last thing before the minutes are touched.
      meetings.getTemplate.mockImplementation(async () => {
        await service.discard(CHAPTER, MEETING, SECRETARY, { keepNotes: true });
        return [...DEFAULT_MEETING_SECTIONS];
      });
      await expect(work()).resolves.toBeUndefined();
      expect(meetings.update).not.toHaveBeenCalled();
      expect(drafts.row).toMatchObject({
        status: 'failed',
        failure_code: 'stopped',
        notes: NOTES,
      });
    });

    it('never reads as waiting while the draft is being put in', async () => {
      const { ask, work, meetings, drafts } = setup();
      await ask();
      let during: string | undefined;
      meetings.update.mockImplementation(() => {
        during = drafts.row?.status;
        return Promise.resolve({});
      });
      await work();
      expect(during).toBe('drafting');
      // In the minutes now, so the sections aren't kept a second time.
      expect(drafts.row?.result).not.toHaveProperty('content');
    });

    it('puts a draft that waited into the minutes at the version on screen, once', async () => {
      const { ask, work, meetings, service, drafts } = setup();
      await ask();
      meetings.update.mockRejectedValueOnce(
        new ConflictException({ code: 'meeting.stale' }),
      );
      await work();
      const V2 = '2026-11-10T03:00:00.000Z';
      const state = await service.use(CHAPTER, MEETING, SECRETARY, V2);
      expect(state.status).toBe('applied');
      const [, , , save] = meetings.update.mock.calls[1];
      expect(save.expected_updated_at).toBe(V2);
      expect(save.content.decisions).toHaveLength(1);
      expect(drafts.row?.result).not.toHaveProperty('content');
      await expect(
        service.use(CHAPTER, MEETING, SECRETARY, V2),
      ).rejects.toMatchObject({
        response: { code: 'meeting.draft_not_waiting' },
      });
    });

    it('stops reading as drafting when no run was ever queued', async () => {
      const { ask, service, drafts } = setup();
      await ask();
      drafts.row!.run_id = null;
      drafts.row!.requested_at = new Date(
        Date.now() - 6 * 60_000,
      ).toISOString();
      const state = await service.state(CHAPTER, MEETING, SECRETARY);
      expect(state.status).toBe('failed');
      expect(state.notes).toBe(NOTES);
    });

    it('checks the officer’s access when it runs, not when they asked', async () => {
      const { ask, work, meetings, drafts, seen } = setup();
      await ask();
      meetings.editableBy.mockRejectedValue(new NotFoundException());
      await expect(work()).rejects.toMatchObject({ reason: 'not_permitted' });
      expect(seen).toHaveLength(0);
      expect(drafts.row).toMatchObject({
        status: 'failed',
        failure_code: 'not_permitted',
        notes: NOTES,
      });
    });

    it('fails cleanly, with no model call, when a cap is reached', async () => {
      const { ask, work, drafts, seen, service } = setup({
        spend: { granted: false, reason: 'chapter_cap' },
      });
      await ask();
      await expect(work()).rejects.toMatchObject({ reason: 'spend_limit' });
      expect(seen).toHaveLength(0);
      expect(drafts.row?.failure_code).toBe('spend_limit');
      const state = await service.state(CHAPTER, MEETING, SECRETARY);
      expect(state.failure_message).toContain('AI limit');
      expect(state.notes).toBe(NOTES);
    });

    it('fails without a retry when the provider declines the notes', async () => {
      const { ask, work, drafts } = setup({
        reply: { refuse: { category: null } },
      });
      await ask();
      const failure = await work().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AiRunFailure);
      expect((failure as AiRunFailure).retryable).toBe(false);
      expect(drafts.row?.failure_code).toBe('refused');
    });

    it('asks for another try when the answer does not fit the schema', async () => {
      const { ask, work, drafts } = setup({
        reply: { text: '{}', object: { summary: 3 } },
      });
      await ask();
      await expect(work()).rejects.toMatchObject({ retryable: true });
      // Still drafting: the queue tries again, or ends it as exhausted.
      expect(drafts.row?.status).toBe('drafting');
    });
  });

  describe('reading where a draft stands', () => {
    it('says none before anything was asked', async () => {
      const { service } = setup();
      await expect(
        service.state(CHAPTER, MEETING, SECRETARY),
      ).resolves.toMatchObject({ status: 'none', notes: '' });
    });

    it('says up front when the officer has not agreed, or the chapter has it off', async () => {
      const declined = setup({
        consent: { allowed: false, reason: 'member_declined' },
      });
      await expect(
        declined.service.state(CHAPTER, MEETING, SECRETARY),
      ).resolves.toMatchObject({ status: 'none', blocked: 'consent_required' });
      const off = setup({ consent: { allowed: false, reason: 'chapter_off' } });
      await expect(
        off.service.state(CHAPTER, MEETING, SECRETARY),
      ).resolves.toMatchObject({ blocked: 'chapter_off' });
    });

    it('is closed to someone who may not edit the minutes', async () => {
      const { service, meetings } = setup();
      meetings.editableBy.mockRejectedValue(new NotFoundException());
      await expect(
        service.state(CHAPTER, MEETING, 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stops waiting on a run that ended without saying why', async () => {
      const { ask, service, runs, drafts } = setup();
      await ask();
      runs.getForMember.mockResolvedValue({
        status: 'failed',
        failure_reason: 'attempts_exhausted',
      });
      const state = await service.state(CHAPTER, MEETING, SECRETARY);
      expect(state).toMatchObject({ status: 'failed', failure: 'failed' });
      expect(state.failure_message).toContain('try again');
      expect(drafts.row?.status).toBe('failed');
    });
  });

  it('discarding clears the notes and stops a run still writing', async () => {
    const { ask, service, drafts, runs } = setup();
    await ask();
    await service.discard(CHAPTER, MEETING, SECRETARY);
    expect(runs.cancel).toHaveBeenCalledWith(CHAPTER, RUN);
    expect(drafts.row).toBeNull();
  });

  describe('what a report may keep (#4315)', () => {
    it('gives the draft and the notes it came from, under its request', async () => {
      const { service, drafts, ask, work } = setup();
      await ask();
      await work();
      const kept = await service.forReport(CHAPTER, MEETING, SECRETARY, null);
      expect(kept).toEqual(
        expect.objectContaining({
          requestId: drafts.row?.request_id,
          notes: NOTES,
          requestedBy: SECRETARY,
        }),
      );
    });

    it('gives nothing while the draft is still being written', async () => {
      const { service, ask } = setup();
      await ask();
      await expect(
        service.forReport(CHAPTER, MEETING, SECRETARY, null),
      ).resolves.toBeNull();
    });

    it('gives nothing to a member the draft routes refuse: no meetings:record, or meetings off', async () => {
      const refused = setup({ permissions: ['members:view'] });
      await refused.ask();
      await refused.work();
      await expect(
        refused.service.forReport(CHAPTER, MEETING, SECRETARY, null),
      ).resolves.toBeNull();

      const off = setup();
      await off.ask();
      await off.work();
      await expect(
        off.service.forReport(CHAPTER, MEETING, SECRETARY, { meetings: false }),
      ).resolves.toBeNull();
    });

    it('never gives Standards minutes', async () => {
      const { service } = setup({
        stored: meeting({ meeting_type: 'standards' as never }),
      });
      await expect(
        service.forReport(CHAPTER, MEETING, SECRETARY, null),
      ).resolves.toBeNull();
    });
  });

  it('the sweep deletes requests older than thirty days', async () => {
    const { service, drafts } = setup();
    const deleted = await service.deleteExpired(
      new Date('2026-12-12T00:00:00.000Z'),
    );
    expect(deleted).toBe(2);
    expect(drafts.deleteRequestedBefore).toHaveBeenCalledWith(
      '2026-11-12T00:00:00.000Z',
    );
  });
});
