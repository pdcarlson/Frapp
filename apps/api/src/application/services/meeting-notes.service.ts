import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MEETING_DRAFT_PROMPT_VERSION,
  MEETING_DRAFT_SOURCES_MAX_LENGTH,
  MEETING_NOTES_MAX_LENGTH,
  STANDARDS_MEETING_REFUSAL,
  STANDARDS_MEETING_TYPE,
  type MeetingType,
} from '@repo/validation';
import {
  MEETING_NOTES_REPOSITORY,
  type IMeetingNotesRepository,
} from '#domain/repositories/meeting-notes.repository.interface';
import {
  MEETING_DRAFT_REPOSITORY,
  type IMeetingDraftRepository,
} from '#domain/repositories/meeting-draft.repository.interface';
import {
  MEETING_RECORDING_REPOSITORY,
  type IMeetingRecordingRepository,
} from '#domain/repositories/meeting-recording.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting, MeetingNote } from '#domain/entities/meeting.entity';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import { aiCatalogEntry } from '#domain/constants/ai-model-catalog';
import { OUTSIDE_TIERS_RANK } from '#domain/utils/role-rank';
import type { MinutesSource } from '#domain/utils/minutes-draft';
import { MeetingService } from './meeting.service';
import { RbacService } from './rbac.service';
import { NotificationService } from './notification.service';
import { AiConsentService } from './ai/ai-consent.service';

/** The catalog task whose consent a note-taker's notes go out under. */
const MINUTES_DRAFT_TASK = 'minutes.draft';

/** Notes older than this are deleted, posted or not (§ Retention). */
export const MEETING_NOTES_RETENTION_DAYS = 30;

/**
 * Ranks a note-taker's notes for settling a disagreement: lower wins. The
 * minutes' author, then `meetings:edit` holders, then role tier by the
 * chapter's own order (#4071). Tier positions start at 0 for the wildcard;
 * the two below sit above every tier.
 */
const AUTHOR_RANK = -2;
const EDITOR_RANK = -1;
/** A rank that survives JSON: outside every tier. */
const OUTSIDE_RANK = 1_000_000;

/** Why a member's notes are left out of the next draft, if they are. */
export type MeetingNoteHeld = 'consent_required' | null;

export interface MeetingNoteTaker {
  user_id: string;
  display_name: string;
  is_author: boolean;
  /** The author or an editor added them; false when they joined themselves. */
  added: boolean;
  /** Their notes, for the author and editors only; "" otherwise. */
  notes: string;
  updated_at: string | null;
  /** Why their notes would be left out of a draft now. */
  held: MeetingNoteHeld;
}

/** What the notes box reads (`GET /v1/meetings/:id/notes`). */
export interface MeetingNotesState {
  meeting: {
    id: string;
    event_id: string | null;
    event_name: string;
    event_start_time: string;
    meeting_type: MeetingType;
    author_name: string;
  };
  /** `editor`: the minutes' author or a `meetings:edit` holder. */
  role: 'editor' | 'note_taker';
  /** The caller's own notes. */
  mine: { notes: string; updated_at: string | null; held: MeetingNoteHeld };
  /** Everyone else taking notes, for editors; empty for a note-taker. */
  takers: MeetingNoteTaker[];
  /** How many others take notes, for anyone. */
  others_count: number;
  can_add: boolean;
  /** The caller already counts as a note-taker. */
  joined: boolean;
}

/** One meeting the caller may take notes on but doesn't edit. */
export interface MeetingNoteTaking {
  meeting_id: string;
  event_id: string;
  event_name: string;
  event_start_time: string;
  meeting_type: MeetingType;
  author_name: string;
  joined: boolean;
  added: boolean;
}

/** What a draft is written from, and whose notes went into it. */
export interface MeetingDraftSources {
  sources: MinutesSource[];
  sourceUserIds: string[];
}

interface NotesAccess {
  meeting: Meeting;
  canEdit: boolean;
  own: MeetingNote | null;
}

/**
 * Several members take notes on one meeting (#4935, `spec/behavior/meetings.md`
 * § Several note-takers). Each writes in their own notes; the minutes'
 * author asks for one draft from all of them and the recording
 * (`MeetingDraftService`).
 *
 * Who takes notes on unposted minutes whose event shows itself to them:
 * - the minutes' author and `meetings:edit` holders, who also read
 *   everyone's notes and add or remove note-takers;
 * - an officer with `meetings:record`, who joins themselves;
 * - any member of the meeting's audience the author or an editor added.
 *
 * A note-taker sees only their own notes and never the draft, which stays
 * its author's. Nobody's notes are in a log, an error or an event.
 */
@Injectable()
export class MeetingNotesService {
  constructor(
    @Inject(MEETING_NOTES_REPOSITORY)
    private readonly notes: IMeetingNotesRepository,
    @Inject(MEETING_DRAFT_REPOSITORY)
    private readonly drafts: IMeetingDraftRepository,
    @Inject(MEETING_RECORDING_REPOSITORY)
    private readonly recordings: IMeetingRecordingRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly meetings: MeetingService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationService,
    private readonly consent: AiConsentService,
  ) {}

  async state(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MeetingNotesState> {
    const access = await this.access(chapterId, meetingId, userId);
    return this.stateOf(chapterId, userId, access);
  }

  /**
   * Saves the caller's notes, making them a note-taker if they weren't.
   * Empty notes clear them, and take with them a draft written from them.
   */
  async save(
    chapterId: string,
    meetingId: string,
    userId: string,
    text: string,
  ): Promise<MeetingNotesState> {
    const access = await this.access(chapterId, meetingId, userId);
    await this.write(chapterId, access, userId, text);
    return this.stateOf(chapterId, userId, {
      ...access,
      own: await this.notes.find(chapterId, meetingId, userId),
    });
  }

  /**
   * The draft's own save of the officer's notes, sent with a request for a
   * draft (`POST /v1/meetings/:id/draft`, which phone builds from before
   * #4935 still call with the notes). The caller is already known to edit
   * the minutes.
   */
  async saveForDraft(
    chapterId: string,
    meeting: Meeting,
    userId: string,
    text: string,
  ): Promise<void> {
    const own = await this.notes.find(chapterId, meeting.id, userId);
    await this.write(chapterId, { meeting, canEdit: true, own }, userId, text);
  }

  /** The caller's own notes on these minutes, or "". */
  async ownNotes(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<string> {
    return (await this.notes.find(chapterId, meetingId, userId))?.notes ?? '';
  }

  /** Clears the caller's notes; an author's or a joiner's row goes with them. */
  async clear(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<void> {
    const access = await this.access(chapterId, meetingId, userId);
    await this.write(chapterId, access, userId, '');
  }

  /**
   * Adds a member of the meeting's audience as a note-taker, for the author
   * or an editor. They are told once. Adding someone already taking notes
   * changes nothing.
   */
  async add(
    chapterId: string,
    meetingId: string,
    actorId: string,
    targetId: string,
  ): Promise<MeetingNotesState> {
    const access = await this.access(chapterId, meetingId, actorId);
    if (!access.canEdit) {
      throw new ForbiddenException(
        'Only the officer who started these minutes can add note-takers.',
      );
    }
    const { meeting } = access;
    if (targetId === meeting.created_by || targetId === actorId) {
      throw new BadRequestException('They already take notes here.');
    }
    const member = await this.memberRepo.findByUserAndChapter(
      targetId,
      chapterId,
    );
    if (!member || member.chapter_id !== chapterId) {
      throw new NotFoundException('That member isn’t in this chapter.');
    }
    if (!(await this.meetings.eventShowsTo(chapterId, meeting, targetId))) {
      throw new BadRequestException({
        code: 'meeting.not_in_audience',
        message:
          'They aren’t invited to this meeting, so they can’t take notes on it.',
      });
    }
    const before = await this.notes.find(chapterId, meetingId, targetId);
    if (!before) {
      await this.notes.add({
        meeting_id: meetingId,
        chapter_id: chapterId,
        user_id: targetId,
        added_by: actorId,
      });
      await this.notifications.notifyMembers(chapterId, [targetId], {
        title: 'Take notes',
        body: `You were asked to take notes at ${meeting.event_name}. Your notes go into the minutes.`,
        category: 'events',
        priority: 'NORMAL',
        data: {
          target: { screen: 'events', eventId: meeting.event_id },
        },
      });
    }
    return this.stateOf(chapterId, actorId, access);
  }

  /**
   * Removes a note-taker, with their notes and any draft written from them.
   * The author or an editor removes anyone; a note-taker removes themselves.
   */
  async remove(
    chapterId: string,
    meetingId: string,
    actorId: string,
    targetId: string,
  ): Promise<void> {
    const access = await this.access(chapterId, meetingId, actorId);
    if (actorId !== targetId && !access.canEdit) {
      throw new ForbiddenException(
        'Only the officer who started these minutes can remove note-takers.',
      );
    }
    await this.notes.delete(chapterId, meetingId, targetId);
    await this.drafts.deleteWrittenFrom(chapterId, meetingId, targetId);
  }

  /**
   * The unposted minutes the caller may take notes on and doesn't edit:
   * the event sheet's and Meetings page's way in for a note-taker.
   */
  async listForUser(
    chapterId: string,
    userId: string,
    eventId?: string,
  ): Promise<MeetingNoteTaking[]> {
    const held = new Set(
      await this.rbac.getEffectivePermissions(chapterId, userId),
    );
    const has = (p: string) => held.has(WILDCARD) || held.has(p);
    // An editor opens every draft as its editor.
    if (has(SystemPermissions.MEETINGS_EDIT)) return [];
    const canRecord = has(SystemPermissions.MEETINGS_RECORD);
    const [drafts, mine, identities] = await Promise.all([
      this.meetings.draftsVisibleTo(chapterId, userId, eventId),
      this.notes.findByUser(chapterId, userId),
      this.memberRepo.findChapterMemberIdentities(chapterId),
    ]);
    const ownRows = new Map(mine.map((row) => [row.meeting_id, row]));
    const names = new Map(identities.map((m) => [m.user_id, m.display_name]));
    return drafts
      .filter((meeting) => meeting.created_by !== userId)
      .filter((meeting) => {
        if (meeting.meeting_type === (STANDARDS_MEETING_TYPE as MeetingType)) {
          return false;
        }
        const own = ownRows.get(meeting.id);
        return canRecord || !!own?.added_by;
      })
      .map((meeting) => {
        const own = ownRows.get(meeting.id);
        return {
          meeting_id: meeting.id,
          event_id: meeting.event_id!,
          event_name: meeting.event_name,
          event_start_time: meeting.event_start_time,
          meeting_type: meeting.meeting_type,
          author_name: nameOf(names, meeting.created_by),
          joined: !!own,
          added: !!own?.added_by,
        };
      });
  }

  /**
   * What a draft of these minutes is written from, as of now: every
   * note-taker's notes that may still go in, then the recording's
   * transcript. Notes are left out when their writer can no longer take
   * notes here, or has not said yes to Frapp AI (their own words go to a
   * provider only with their yes). 400 when there is nothing to draft from,
   * or more than one draft reads.
   */
  async sourcesFor(
    chapterId: string,
    meeting: Meeting,
  ): Promise<MeetingDraftSources> {
    const [rows, recording, identities] = await Promise.all([
      this.notes.findByMeeting(chapterId, meeting.id),
      this.recordings.find(chapterId, meeting.id),
      this.memberRepo.findChapterMemberIdentities(chapterId),
    ]);
    const names = new Map(identities.map((m) => [m.user_id, m.display_name]));
    const written = rows.filter((row) => row.notes.trim().length > 0);

    const ranked: (MinutesSource & { order: number })[] = [];
    for (const row of written) {
      const standing = await this.standingOf(chapterId, meeting, row);
      if (!standing) continue;
      ranked.push({
        id: '',
        kind: 'notes',
        label: nameOf(names, row.user_id),
        standing: standing.label,
        rank: standing.rank,
        userId: row.user_id,
        text: row.notes.trim(),
        order: row.user_id === meeting.created_by ? 0 : 1,
      });
    }
    ranked.sort((a, b) => a.order - b.order || a.rank - b.rank);

    const transcript =
      recording?.status === 'ready' ? (recording.transcript ?? '').trim() : '';
    // A phone from before #4935 put the transcript into its notes; it is
    // then read once, as those notes.
    const transcriptInNotes =
      transcript.length > 0 &&
      ranked.some((source) => source.text.includes(transcript));
    const sources: MinutesSource[] = ranked.map((source, index) => ({
      id: `S${index + 1}`,
      kind: source.kind,
      label: source.label,
      standing: source.standing,
      rank: source.rank,
      userId: source.userId,
      text: source.text,
    }));
    if (transcript && !transcriptInNotes) {
      sources.push({
        id: `S${sources.length + 1}`,
        kind: 'recording',
        label: 'Recording',
        standing: null,
        rank: OUTSIDE_RANK,
        userId: null,
        text: transcript,
      });
    }
    if (sources.length === 0) {
      throw new BadRequestException('Paste or type your notes first.');
    }
    const total = sources.reduce((sum, source) => sum + source.text.length, 0);
    if (total > MEETING_DRAFT_SOURCES_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'meeting.notes_too_long',
        message: `Together the notes and the transcript run past ${MEETING_DRAFT_SOURCES_MAX_LENGTH.toLocaleString('en-US')} characters. Shorten someone’s notes, or draft the meeting in two parts.`,
      });
    }
    return {
      sources,
      sourceUserIds: sources.flatMap((source) =>
        source.userId ? [source.userId] : [],
      ),
    };
  }

  /** The retention sweep: every note-taker's notes older than the limit. */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - MEETING_NOTES_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return this.notes.deleteCreatedBefore(cutoff.toISOString());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Whether `userId` may take notes on these minutes, and how. 404 for
   * anyone who may not, the same answer a missing id gets, so a member the
   * event leaves out can't learn an Exec meeting has minutes.
   */
  private async access(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<NotesAccess> {
    const view = await this.meetings.noteTakingView(
      chapterId,
      meetingId,
      userId,
    );
    const { meeting } = view;
    const own = await this.notes.find(chapterId, meetingId, userId);
    const allowed =
      view.canEdit ||
      (view.eventVisible && (!!own?.added_by || view.canRecord));
    if (!allowed) throw new NotFoundException('Minutes not found');
    assertNotesOpen(meeting);
    return { meeting, canEdit: view.canEdit, own };
  }

  private async write(
    chapterId: string,
    access: NotesAccess,
    userId: string,
    text: string,
  ): Promise<void> {
    const notes = text.replace(/\s+$/u, '');
    if (notes.length > MEETING_NOTES_MAX_LENGTH) {
      throw new BadRequestException(
        `Notes can be up to ${MEETING_NOTES_MAX_LENGTH.toLocaleString('en-US')} characters.`,
      );
    }
    const { meeting, own } = access;
    if (notes.trim().length === 0) {
      // A member someone added stays on as a note-taker with empty notes;
      // anyone else's row goes.
      if (own?.added_by) {
        await this.notes.upsert({
          meeting_id: meeting.id,
          chapter_id: chapterId,
          user_id: userId,
          notes: '',
          added_by: own.added_by,
        });
      } else if (own) {
        await this.notes.delete(chapterId, meeting.id, userId);
      }
      await this.drafts.deleteWrittenFrom(chapterId, meeting.id, userId);
      return;
    }
    await this.notes.upsert({
      meeting_id: meeting.id,
      chapter_id: chapterId,
      user_id: userId,
      notes,
      added_by: own?.added_by ?? null,
    });
  }

  private async stateOf(
    chapterId: string,
    userId: string,
    access: NotesAccess,
  ): Promise<MeetingNotesState> {
    const { meeting, canEdit } = access;
    const [rows, identities] = await Promise.all([
      this.notes.findByMeeting(chapterId, meeting.id),
      this.memberRepo.findChapterMemberIdentities(chapterId),
    ]);
    const names = new Map(identities.map((m) => [m.user_id, m.display_name]));
    const own = rows.find((row) => row.user_id === userId) ?? null;
    const others = rows.filter((row) => row.user_id !== userId);
    const takers: MeetingNoteTaker[] = canEdit
      ? await Promise.all(
          others.map(async (row) => ({
            user_id: row.user_id,
            display_name: nameOf(names, row.user_id),
            is_author: row.user_id === meeting.created_by,
            added: !!row.added_by,
            notes: row.notes,
            updated_at: row.notes ? row.updated_at : null,
            held: await this.heldFor(chapterId, row.user_id),
          })),
        )
      : [];
    return {
      meeting: {
        id: meeting.id,
        event_id: meeting.event_id,
        event_name: meeting.event_name,
        event_start_time: meeting.event_start_time,
        meeting_type: meeting.meeting_type,
        author_name: nameOf(names, meeting.created_by),
      },
      role: canEdit ? 'editor' : 'note_taker',
      mine: {
        notes: own?.notes ?? '',
        updated_at: own?.updated_at ?? null,
        held: await this.heldFor(chapterId, userId),
      },
      takers,
      others_count: others.length,
      can_add: canEdit,
      joined: !!own || canEdit,
    };
  }

  /** Whether a member's notes would go out under their own yes now. */
  private async heldFor(
    chapterId: string,
    userId: string,
  ): Promise<MeetingNoteHeld> {
    const entry = aiCatalogEntry(MINUTES_DRAFT_TASK);
    const decision = await this.consent.check({
      chapterId,
      actingUserId: userId,
      task: MINUTES_DRAFT_TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: MEETING_DRAFT_PROMPT_VERSION,
    });
    // The chapter's switch is the draft's own gate; only the member's answer
    // holds back one person's notes.
    return decision.allowed || decision.reason === 'chapter_off'
      ? null
      : 'consent_required';
  }

  /**
   * How a note-taker's notes rank now, or null when they are left out: the
   * writer can't take notes here any more, or hasn't said yes to Frapp AI.
   */
  private async standingOf(
    chapterId: string,
    meeting: Meeting,
    row: MeetingNote,
  ): Promise<{ rank: number; label: string } | null> {
    if ((await this.heldFor(chapterId, row.user_id)) !== null) return null;
    const context = await this.rbac.getRankContext(chapterId, row.user_id);
    const { reach } = context;
    if (!reach.memberId) return null;
    const visible = await this.meetings.eventShowsTo(
      chapterId,
      meeting,
      row.user_id,
    );
    const canEditAny =
      reach.wildcard || reach.permissions.has(SystemPermissions.MEETINGS_EDIT);
    const isAuthor = row.user_id === meeting.created_by;
    const canRecord =
      reach.wildcard ||
      reach.permissions.has(SystemPermissions.MEETINGS_RECORD);
    const may =
      canEditAny || (visible && (isAuthor || !!row.added_by || canRecord));
    if (!may) return null;
    if (isAuthor) return { rank: AUTHOR_RANK, label: 'minutes author' };
    if (canEditAny) return { rank: EDITOR_RANK, label: 'edits any minutes' };
    if (reach.rank === OUTSIDE_TIERS_RANK) {
      return { rank: OUTSIDE_RANK, label: 'member' };
    }
    const tier = context.tiers.find(
      (t) => context.positions.get(t.id) === reach.rank,
    );
    return { rank: reach.rank, label: tier?.name ?? 'member' };
  }
}

/**
 * Notes are taken only on unposted minutes of a type Frapp drafts: Standards
 * is refused before any text is stored (§ Standards meetings).
 */
function assertNotesOpen(meeting: Meeting): void {
  if ((meeting.meeting_type as string) === STANDARDS_MEETING_TYPE) {
    throw new BadRequestException({
      code: 'meeting.standards_refused',
      message: STANDARDS_MEETING_REFUSAL,
    });
  }
  if (meeting.status !== 'draft') {
    throw new ConflictException({
      code: 'meeting.draft_posted',
      message: 'These minutes are already posted.',
    });
  }
}

function nameOf(names: ReadonlyMap<string, string>, userId: string | null) {
  return (userId && names.get(userId)?.trim()) || 'A member';
}
