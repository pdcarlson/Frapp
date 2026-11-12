import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  EMPTY_MEETING_DRAFT_REVIEW,
  MEETING_DRAFT_FAILURE_COPY,
  MEETING_DRAFT_PROMPT_VERSION,
  MEETING_NOTES_MAX_LENGTH,
  MeetingDraftOutputSchema,
  MeetingDraftReviewSchema,
  STANDARDS_MEETING_REFUSAL,
  STANDARDS_MEETING_TYPE,
  isMeetingDraftFailure,
  readMeetingContent,
  type MeetingContent,
  type MeetingDraftFailure,
  type MeetingDraftReview,
  type MeetingDraftStatus,
} from '@repo/validation';
import {
  MEETING_DRAFT_REPOSITORY,
  type IMeetingDraftRepository,
} from '#domain/repositories/meeting-draft.repository.interface';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting, MeetingDraft } from '#domain/entities/meeting.entity';
import type { AiRunFailureReason } from '#domain/entities/ai-run.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import {
  buildMinutesDraftPrompt,
  verifyMinutesDraft,
  type MinutesDraftRequest,
  type MinutesRosterMember,
} from '#domain/utils/minutes-draft';
import { MeetingService } from './meeting.service';
import { RbacService } from './rbac.service';
import { AiRunService } from './ai-run.service';
import {
  AiRunFailure,
  AiRunRegistry,
  type AiRunContext,
  type AiRunHandler,
} from './ai-run-registry';
import { AiGatewayService } from './ai/ai-gateway.service';
import { AiConsentService } from './ai/ai-consent.service';
import { aiConsentRefusal } from './ai/ai-consent-refusal';

/** The catalog task, and the AI run kind, for a draft from notes. */
export const MINUTES_DRAFT_TASK = 'minutes.draft';
export const MINUTES_DRAFT_RUN_KIND = 'minutes_draft';

/** Notes and drafts older than this are deleted, posted or not. */
export const MEETING_DRAFT_RETENTION_DAYS = 30;

/** What the editor reads about a meeting's draft from notes. */
export interface MeetingDraftState {
  status: MeetingDraftStatus;
  /** The officer's notes, so the box is as they left it. Empty when none. */
  notes: string;
  failure: MeetingDraftFailure | null;
  /** The failure in plain words. */
  failure_message: string | null;
  /**
   * The drafted sections, only while `ready`: the minutes changed while the
   * draft was written, so it waits for the officer to use it.
   */
  content: Partial<MeetingContent> | null;
  /** What to check the draft against; empty until one is written. */
  review: MeetingDraftReview;
  requested_at: string | null;
  /**
   * Why this viewer can't ask for a draft right now, known before they paste
   * anything: the chapter has meeting notes off, or they have not said yes on
   * the AI sheet. Null when they can ask.
   */
  blocked: 'chapter_off' | 'consent_required' | null;
}

export interface RequestMeetingDraftInput {
  notes: string;
  /** The minutes' `updated_at` the editor has; a draft over a newer save is refused. */
  expected_updated_at: string;
  /** The meeting's calendar day where the officer is, `YYYY-MM-DD`. */
  meeting_date?: string;
}

/** How long a request with no run may read as `drafting`. */
const ORPHANED_REQUEST_MS = 5 * 60 * 1000;

const NO_DRAFT: MeetingDraftState = {
  status: 'none',
  notes: '',
  failure: null,
  failure_message: null,
  content: null,
  review: EMPTY_MEETING_DRAFT_REVIEW,
  requested_at: null,
  blocked: null,
};

/** How a run that ended without the handler saying why reads to the officer. */
const RUN_FAILURES: Partial<Record<AiRunFailureReason, MeetingDraftFailure>> = {
  ai_unavailable: 'unavailable',
  not_permitted: 'not_permitted',
  source_gone: 'not_permitted',
  spend_limit: 'spend_limit',
};

/**
 * Minutes drafted from an officer's notes (`spec/behavior/meetings.md`
 * § Drafting from notes, #4312, ADR-28 decision 6).
 *
 * The officer pastes notes and asks; the draft is written by an AI run
 * (`minutes_draft`) through the gateway, checked by Frapp
 * (`#domain/utils/minutes-draft`), and put into the same minutes the officer
 * edits by hand. Nothing is posted here: posting stays the officer's act in
 * `MeetingService`.
 *
 * Refused before any text is stored or sent: a Standards meeting, minutes
 * the caller can't edit, posted minutes, a chapter with meeting notes off,
 * and an officer who has not said yes on the AI sheet. The gateway checks
 * consent and the spend caps again when the run runs.
 *
 * The notes live in `meeting_drafts` and nowhere else, and never in a log,
 * an error or an event.
 */
@Injectable()
export class MeetingDraftService implements AiRunHandler, OnModuleInit {
  private readonly logger = new Logger(MeetingDraftService.name);

  readonly kind = MINUTES_DRAFT_RUN_KIND;
  readonly label = 'Drafting minutes';
  readonly actsForMember = true;
  /** Still an officer who may write minutes when the run runs. */
  readonly runPermissions = [SystemPermissions.MEETINGS_RECORD];
  /** An officer is waiting on the page: two tries, two minutes each. */
  readonly maxAttempts = 2;
  readonly timeoutMs = 120_000;

  constructor(
    @Inject(MEETING_DRAFT_REPOSITORY)
    private readonly drafts: IMeetingDraftRepository,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly meetings: MeetingService,
    private readonly rbac: RbacService,
    private readonly runs: AiRunService,
    private readonly registry: AiRunRegistry,
    private readonly gateway: AiGatewayService,
    private readonly consent: AiConsentService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Where the meeting's draft stands, for whoever may edit its minutes. */
  async state(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MeetingDraftState> {
    await this.meetings.editableBy(chapterId, meetingId, userId);
    const [draft, consent] = await Promise.all([
      this.drafts.find(chapterId, meetingId),
      this.consentFor(chapterId, userId),
    ]);
    const blocked = consent.allowed
      ? null
      : consent.reason === 'chapter_off'
        ? 'chapter_off'
        : 'consent_required';
    if (!draft) return { ...NO_DRAFT, blocked };
    return { ...this.stateOf(await this.settled(draft)), blocked };
  }

  /**
   * Stores the notes and queues the draft. Asking again replaces the earlier
   * request, notes and result, and stops its run.
   */
  async request(
    chapterId: string,
    meetingId: string,
    userId: string,
    input: RequestMeetingDraftInput,
  ): Promise<MeetingDraftState> {
    const meeting = await this.meetings.editableBy(
      chapterId,
      meetingId,
      userId,
    );
    this.assertDraftable(meeting);

    const notes = input.notes.trim();
    if (!notes) {
      throw new BadRequestException('Paste or type your notes first.');
    }
    if (notes.length > MEETING_NOTES_MAX_LENGTH) {
      throw new BadRequestException(
        `Notes can be up to ${MEETING_NOTES_MAX_LENGTH.toLocaleString('en-US')} characters. Shorten them, or draft the meeting in two parts.`,
      );
    }
    if (meeting.updated_at !== input.expected_updated_at) {
      throw new ConflictException({
        code: 'meeting.stale',
        message:
          'Someone else saved these minutes while you were editing. Reload to see their changes.',
      });
    }

    // The same check the gateway makes when the run runs, made now so the
    // officer is told at once and no notes are stored for a call that can't
    // be made.
    const consent = await this.consentFor(chapterId, userId);
    if (!consent.allowed) throw aiConsentRefusal(consent.reason);

    const earlier = await this.drafts.find(chapterId, meetingId);
    if (earlier?.status === 'drafting' && earlier.run_id) {
      await this.runs.cancel(chapterId, earlier.run_id);
    }

    const requestId = randomUUID();
    const draft = await this.drafts.replace({
      meeting_id: meetingId,
      chapter_id: chapterId,
      request_id: requestId,
      requested_by: userId,
      notes,
      meeting_date: meetingDateOf(meeting, input.meeting_date),
      base_updated_at: meeting.updated_at,
    });

    try {
      const run = await this.runs.enqueue({
        chapterId,
        kind: MINUTES_DRAFT_RUN_KIND,
        // One run per request: a new request is new work, never the answer
        // to an older one.
        dedupeKey: `meeting:${meetingId}:${requestId}`,
        requestedBy: userId,
        actingUserId: userId,
        input: { meeting_id: meetingId, request_id: requestId },
      });
      await this.drafts.setRun(chapterId, meetingId, requestId, run.id);
      return this.stateOf({ ...draft, run_id: run.id });
    } catch (error) {
      // Nothing will draft from these notes. They are kept, so the officer
      // doesn't paste them twice, and the request reads as failed.
      await this.drafts.finish(chapterId, meetingId, requestId, ['drafting'], {
        status: 'failed',
        failure_code: 'unavailable',
      });
      throw error;
    }
  }

  /**
   * Clears the notes and the draft, and stops a run still writing one. With
   * `keepNotes`, only stops: the request ends as `stopped` and the notes stay
   * for the officer to ask again.
   */
  async discard(
    chapterId: string,
    meetingId: string,
    userId: string,
    options: { keepNotes?: boolean } = {},
  ): Promise<void> {
    await this.meetings.editableBy(chapterId, meetingId, userId);
    const draft = await this.drafts.find(chapterId, meetingId);
    if (!draft) return;
    if (draft.status === 'drafting' && draft.run_id) {
      await this.runs.cancel(chapterId, draft.run_id);
    }
    if (options.keepNotes) {
      // Only a draft still being written is stopped; one that has landed
      // stays as it is.
      await this.drafts.finish(
        chapterId,
        meetingId,
        draft.request_id,
        ['drafting'],
        { status: 'failed', failure_code: 'stopped' },
      );
      return;
    }
    await this.drafts.delete(chapterId, meetingId);
  }

  /**
   * Puts a draft that waited (`ready`) into the minutes, at the version the
   * officer now has on screen. The same compare-and-set as a save, so it
   * can't overwrite one either: 409 `meeting.stale` when the minutes moved
   * again. 409 `meeting.draft_not_waiting` when there is no such draft.
   */
  async use(
    chapterId: string,
    meetingId: string,
    userId: string,
    expectedUpdatedAt: string,
  ): Promise<MeetingDraftState> {
    const meeting = await this.meetings.editableBy(
      chapterId,
      meetingId,
      userId,
    );
    this.assertDraftable(meeting);
    const draft = await this.drafts.find(chapterId, meetingId);
    const stored = draft?.result ?? {};
    const drafted =
      stored.content && typeof stored.content === 'object'
        ? draftedSections(stored.content as Record<string, unknown>)
        : null;
    if (!draft || draft.status !== 'ready' || !drafted) {
      throw new ConflictException({
        code: 'meeting.draft_not_waiting',
        message: 'There is no draft waiting to be used. Ask for one again.',
      });
    }
    await this.meetings.update(chapterId, meetingId, userId, {
      expected_updated_at: expectedUpdatedAt,
      content: drafted,
    });
    const used = await this.drafts.finish(
      chapterId,
      meetingId,
      draft.request_id,
      ['ready'],
      { status: 'applied', result: { review: stored.review ?? null } },
    );
    const consent = await this.consentFor(chapterId, userId);
    return {
      ...this.stateOf(used ?? { ...draft, status: 'applied' }),
      blocked: consent.allowed
        ? null
        : consent.reason === 'chapter_off'
          ? 'chapter_off'
          : 'consent_required',
    };
  }

  /**
   * What "Report this" keeps of a draft (#4315): the notes it was written
   * from and what it wrote, for whoever may see that draft (an editor of the
   * minutes). Once the draft is in the minutes the row keeps only the review,
   * so the minutes as they are now stand in for what it wrote. Null when
   * there is no draft. Never a Standards meeting: none is ever drafted, and
   * a report must not hold Standards material either.
   */
  async forReport(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<{
    /** One per request: a draft asked for again is a new thing to report. */
    requestId: string;
    notes: string;
    meetingDate: string;
    status: string;
    result: Record<string, unknown> | null;
    minutesNow: unknown;
    /** The officer whose notes they are. */
    requestedBy: string | null;
  } | null> {
    const meeting = await this.meetings.editableBy(
      chapterId,
      meetingId,
      userId,
    );
    if ((meeting.meeting_type as string) === STANDARDS_MEETING_TYPE) {
      return null;
    }
    const draft = await this.drafts.find(chapterId, meetingId);
    if (!draft || draft.status === 'drafting') return null;
    return {
      requestId: draft.request_id,
      notes: draft.notes,
      meetingDate: draft.meeting_date,
      status: draft.status,
      result: draft.result,
      minutesNow: draft.status === 'applied' ? meeting.content : null,
      requestedBy: draft.requested_by,
    };
  }

  /** The retention sweep: every request older than the limit, everywhere. */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - MEETING_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.drafts.deleteRequestedBefore(cutoff.toISOString());
  }

  // ── The AI run ────────────────────────────────────────────────────────────

  /**
   * Writes the draft. Safe to run twice for one request: a request that has
   * already ended, or that the officer replaced or cleared, writes nothing.
   */
  async run({ run, input, signal }: AiRunContext) {
    const meetingId = String(input.meeting_id);
    const requestId = String(input.request_id);
    const chapterId = run.chapter_id;
    const userId = run.acting_user_id;

    const draft = await this.drafts.find(chapterId, meetingId);
    if (
      !draft ||
      draft.request_id !== requestId ||
      draft.status !== 'drafting'
    ) {
      return;
    }
    const fail = async (
      failure: MeetingDraftFailure,
      reason: AiRunFailureReason,
    ): Promise<never> => {
      await this.drafts.finish(chapterId, meetingId, requestId, ['drafting'], {
        status: 'failed',
        failure_code: failure,
      });
      throw new AiRunFailure(reason, `minutes draft ended: ${failure}`);
    };
    if (!userId) return fail('not_permitted', 'not_permitted');

    // The officer's access now, not when they asked.
    let meeting: Meeting;
    try {
      meeting = await this.meetings.editableBy(chapterId, meetingId, userId);
      this.assertDraftable(meeting);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        return fail('not_permitted', 'not_permitted');
      }
      throw error;
    }

    const request = await this.draftRequest(chapterId, meeting, draft);
    const prompt = buildMinutesDraftPrompt(request);
    const result = await this.gateway.generateObject(
      MINUTES_DRAFT_TASK,
      { ...prompt, schema: MeetingDraftOutputSchema, signal },
      { chapterId, actingUserId: userId, runId: run.id },
    );

    if (result.status === 'unavailable') {
      if (result.reason === 'consent') {
        return fail(
          result.detail === 'chapter_off' ? 'chapter_off' : 'consent_required',
          'not_permitted',
        );
      }
      if (result.reason === 'spend_cap') {
        return fail('spend_limit', 'spend_limit');
      }
      return fail('unavailable', 'ai_unavailable');
    }
    if (result.status === 'refused') return fail('refused', 'handler_failed');
    if (result.status === 'invalid_output') {
      // A second try often fits; the run fails as exhausted if it doesn't.
      throw new AiRunFailure(
        'handler_failed',
        'minutes draft did not match its schema',
        true,
      );
    }

    const verified = verifyMinutesDraft(result.value, request);
    // The officer asked again, stopped or cleared their notes while this was
    // written: nothing of it goes anywhere. Read again here, as late as it
    // can be, because the row stays `drafting` until the minutes are settled
    // (a page that polls must never see a draft "waiting" that is about to
    // be put in).
    const current = await this.drafts.find(chapterId, meetingId);
    if (
      !current ||
      current.request_id !== requestId ||
      current.status !== 'drafting'
    ) {
      return;
    }

    const counts = {
      decision_count: verified.content.decisions?.length ?? 0,
      action_item_count: verified.content.action_items?.length ?? 0,
      left_out_count: verified.review.left_out,
    };
    try {
      // Only onto the version the officer asked on: a save made since is
      // never overwritten, and the draft then waits as `ready`.
      await this.meetings.update(chapterId, meetingId, userId, {
        expected_updated_at: draft.base_updated_at,
        content: verified.content,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        // Someone saved since: the draft waits, sections and all, for the
        // officer to use.
        await this.drafts.finish(
          chapterId,
          meetingId,
          requestId,
          ['drafting'],
          {
            status: 'ready',
            result: { content: verified.content, review: verified.review },
          },
        );
        return { meeting_id: meetingId, applied: false, ...counts };
      }
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        return fail('not_permitted', 'not_permitted');
      }
      // The minutes refused what was drafted (an owner who has since left).
      if (error instanceof BadRequestException) {
        return fail('failed', 'handler_failed');
      }
      throw error;
    }
    // In the minutes now, so the drafted sections are not kept a second
    // time: only what the officer checks them against.
    await this.drafts.finish(chapterId, meetingId, requestId, ['drafting'], {
      status: 'applied',
      result: { review: verified.review },
    });
    return { meeting_id: meetingId, applied: true, ...counts };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** The chapter's switch and the member's answer, for this task. */
  private consentFor(chapterId: string, userId: string) {
    const entry = aiCatalogEntry(MINUTES_DRAFT_TASK);
    return this.consent.check({
      chapterId,
      actingUserId: userId,
      task: MINUTES_DRAFT_TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: MEETING_DRAFT_PROMPT_VERSION,
    });
  }

  /**
   * A draft is written only for unposted minutes of a type Frapp drafts.
   * Standards is refused here as well as where minutes are started and
   * typed, before any text is stored or sent (§ Standards meetings).
   */
  private assertDraftable(meeting: Meeting): void {
    if ((meeting.meeting_type as string) === STANDARDS_MEETING_TYPE) {
      throw new BadRequestException({
        code: 'meeting.standards_refused',
        message: STANDARDS_MEETING_REFUSAL,
      });
    }
    if (meeting.status !== 'draft') {
      throw new ConflictException({
        code: 'meeting.draft_posted',
        message:
          'These minutes are already posted. Edit them by hand from here.',
      });
    }
  }

  /** What the model is told: the meeting, the template, the roster, the notes. */
  private async draftRequest(
    chapterId: string,
    meeting: Meeting,
    draft: MeetingDraft,
  ): Promise<MinutesDraftRequest> {
    const [sections, members, roles, attendance] = await Promise.all([
      this.meetings.getTemplate(chapterId),
      this.memberRepo.findChapterMemberIdentities(chapterId),
      this.rbac.findByChapter(chapterId),
      meeting.event_id
        ? this.attendanceRepo.findByEvent(meeting.event_id)
        : Promise.resolve([]),
    ]);
    const roleNames = new Map(roles.map((role) => [role.id, role.name]));
    const checkedIn = new Set(
      attendance
        .filter((row) => row.status === 'PRESENT' || row.status === 'LATE')
        .map((row) => row.user_id),
    );
    const roster: MinutesRosterMember[] = members
      .filter((member) => member.display_name.trim().length > 0)
      .map((member) => ({
        userId: member.user_id,
        name: member.display_name.trim(),
        roles: member.role_ids.flatMap((id) => roleNames.get(id) ?? []),
        checkedIn: checkedIn.has(member.user_id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      meetingName: meeting.event_name,
      meetingType: meeting.meeting_type,
      otherLabel: meeting.other_label,
      meetingDate: draft.meeting_date,
      sections,
      roster,
      notes: draft.notes,
    };
  }

  /**
   * A request still marked `drafting` whose run has ended without the
   * handler recording why (it ran out of tries, was cancelled, or its member
   * left) is recorded as failed here, so the page stops waiting.
   */
  private async settled(draft: MeetingDraft): Promise<MeetingDraft> {
    if (draft.status !== 'drafting') return draft;
    let failure: MeetingDraftFailure | null = null;
    if (!draft.run_id || !draft.requested_by) {
      // No run was ever queued for it (the server stopped between storing
      // the notes and queueing the work), or its member is gone. Past the
      // time a draft takes, nothing is coming.
      const waited = Date.now() - Date.parse(draft.requested_at);
      if (waited > ORPHANED_REQUEST_MS) failure = 'failed';
    } else
      try {
        const run = await this.runs.getForMember(
          draft.chapter_id,
          draft.requested_by,
          draft.run_id,
        );
        if (run.status === 'failed' || run.status === 'cancelled') {
          failure =
            (run.failure_reason && RUN_FAILURES[run.failure_reason]) ||
            'failed';
        }
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        // The run is gone, or AI was switched off since.
        failure = 'unavailable';
      }
    if (!failure) return draft;
    const ended = await this.drafts.finish(
      draft.chapter_id,
      draft.meeting_id,
      draft.request_id,
      ['drafting'],
      { status: 'failed', failure_code: failure },
    );
    // Lost to the handler finishing at the same moment: read what it wrote.
    return (
      ended ??
      (await this.drafts.find(draft.chapter_id, draft.meeting_id)) ??
      draft
    );
  }

  private stateOf(draft: MeetingDraft): MeetingDraftState {
    const failure =
      draft.status === 'failed'
        ? isMeetingDraftFailure(draft.failure_code)
          ? draft.failure_code
          : 'failed'
        : null;
    const result = draft.result ?? {};
    const review = MeetingDraftReviewSchema.safeParse(result.review);
    const drafted =
      result.content && typeof result.content === 'object'
        ? (result.content as Record<string, unknown>)
        : null;
    return {
      status: draft.status,
      notes: draft.notes,
      failure,
      failure_message: failure ? MEETING_DRAFT_FAILURE_COPY[failure] : null,
      content:
        draft.status === 'ready' && drafted ? draftedSections(drafted) : null,
      review: review.success ? review.data : EMPTY_MEETING_DRAFT_REVIEW,
      requested_at: draft.requested_at,
      blocked: null,
    };
  }
}

/** The stored sections, read as minutes; only the sections that were drafted. */
function draftedSections(
  stored: Record<string, unknown>,
): Partial<MeetingContent> {
  const read = readMeetingContent(stored);
  return Object.fromEntries(
    Object.entries(read).filter(([key]) => key in stored),
  );
}

/**
 * The meeting's calendar day. The officer's browser knows it; the server
 * only has the event's start in UTC, which is a day off for an evening
 * meeting west of Greenwich. The client's day is used when it is within a
 * day of the event's start, and the UTC day otherwise.
 */
function meetingDateOf(meeting: Meeting, fromClient?: string): string {
  const utcDay = meeting.event_start_time.slice(0, 10);
  if (!fromClient || !/^\d{4}-\d{2}-\d{2}$/.test(fromClient)) return utcDay;
  const noon = new Date(`${fromClient}T12:00:00.000Z`);
  // A real calendar day: "2026-02-30" parses, as 2 March.
  if (
    Number.isNaN(noon.getTime()) ||
    noon.toISOString().slice(0, 10) !== fromClient
  ) {
    return utcDay;
  }
  const apart = Math.abs(noon.getTime() - Date.parse(meeting.event_start_time));
  return apart <= 36 * 60 * 60 * 1000 ? fromClient : utcDay;
}
