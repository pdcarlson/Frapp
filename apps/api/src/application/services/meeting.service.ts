import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EMPTY_MEETING_CONTENT,
  MEETING_TEXT_MAX_LENGTH,
  STANDARDS_MEETING_REFUSAL,
  STANDARDS_MEETING_TYPE,
  isMeetingType,
  normalizeMeetingSections,
  readMeetingContent,
  type MeetingContent,
  type MeetingSectionKey,
  type MeetingType,
} from '@repo/validation';
import { MEETING_REPOSITORY } from '#domain/repositories/meeting.repository.interface';
import type {
  IMeetingRepository,
  MeetingWrite,
} from '#domain/repositories/meeting.repository.interface';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { EventService } from './event.service';
import { RbacService } from './rbac.service';
import { NotificationService } from './notification.service';
import { isInvited } from './event-role-targeting';

/** The most minutes the list reads; a chapter meets about weekly. */
export const MEETING_LIST_LIMIT = 500;

/** Who checked in, by the event's own attendance record. */
export interface MeetingAttendees {
  present: string[];
  late: string[];
  excused: string[];
}

/** What a reader gets for one set of minutes. */
export interface MeetingView {
  meeting: Meeting;
  content: MeetingContent;
  /** The chapter's template, in order. */
  sections: MeetingSectionKey[];
  /** `null` when the event is gone. */
  attendees: MeetingAttendees | null;
  /** The event's end, read live; `null` when the event is gone. */
  event_end_time: string | null;
  can_edit: boolean;
  can_delete: boolean;
}

/** A section-by-section change; a section left out keeps what is stored. */
export type MeetingContentPatch = Partial<MeetingContent>;

export interface StartMeetingInput {
  meeting_type: string;
  other_label?: string | null;
  /** The meeting's event. Exactly one of this and `new_event`. */
  event_id?: string;
  /**
   * A meeting with no event gets one now, with the audience the officer
   * picks (`meetings.md` § Workflow, step 1): everyone, or only the members
   * holding `role_ids`. Nobody is required to attend and it carries no
   * points, so a meeting written up afterwards never marks anyone absent.
   */
  new_event?: {
    name: string;
    start_time: string;
    end_time: string;
    /** Empty or omitted: everyone in the chapter. */
    role_ids?: string[];
  };
}

export interface UpdateMeetingInput {
  /** The `updated_at` the editor loaded; a save over a newer one is refused. */
  expected_updated_at: string;
  meeting_type?: string;
  other_label?: string | null;
  content?: MeetingContentPatch;
}

interface ViewerAccess {
  canEditAny: boolean;
  canDelete: boolean;
}

/**
 * Meeting minutes written by hand (`spec/behavior/meetings.md`, #4312). No
 * model call happens here; the AI draft builds on these rows later.
 *
 * Who reads what (§ Who can read minutes):
 * - posted minutes: the members the event invites, by the event's own read
 *   rule (`EventService.findById` with a viewer), so an Exec meeting's minutes
 *   are exec-only without a setting of their own. Minutes whose event was
 *   deleted have no audience and are read only by `meetings:edit` holders.
 * - a draft: its author and `meetings:edit` holders. Another officer who
 *   tries to start minutes for the same event learns only that some exist.
 *
 * Who writes (§ Permissions): `meetings:record` starts minutes; the author
 * and `meetings:edit` holders edit and post them; `meetings:delete` deletes,
 * and an author may throw away their own unposted draft.
 */
@Injectable()
export class MeetingService {
  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepo: IMeetingRepository,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly events: EventService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationService,
  ) {}

  /** The minutes the viewer may read, newest meeting first. */
  async list(
    chapterId: string,
    viewerId: string,
    eventId?: string,
  ): Promise<Meeting[]> {
    const rows = eventId
      ? await this.meetingRepo
          .findByEvent(chapterId, eventId)
          .then((row) => (row ? [row] : []))
      : await this.meetingRepo.findByChapter(chapterId, MEETING_LIST_LIMIT);
    if (rows.length === 0) return [];
    const access = await this.access(chapterId, viewerId);
    // Only the events these rows point at, never the whole calendar: a
    // `meetings:edit` holder reads every row anyway.
    const pointedAt = access.canEditAny
      ? []
      : rows.flatMap((row) =>
          row.event_id &&
          (row.status === 'posted' || row.created_by === viewerId)
            ? [row.event_id]
            : [],
        );
    const visibleEventIds = new Set(
      (await this.events.findVisibleByIds(pointedAt, chapterId, viewerId)).map(
        (event) => event.id,
      ),
    );
    return rows.filter((row) =>
      this.readable(row, viewerId, access, (id) => visibleEventIds.has(id)),
    );
  }

  /**
   * Whether `userId` may read these minutes. The one door other features use
   * (a suggestion pointing at minutes, the AI index later), so the rule lives
   * in one place. A missing or other-chapter id is `false`.
   */
  async canRead(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<boolean> {
    const meeting = await this.meetingRepo.findById(chapterId, meetingId);
    if (!meeting) return false;
    const access = await this.access(chapterId, userId);
    return (
      (await this.readableEvent(chapterId, meeting, userId, access)) !== false
    );
  }

  /**
   * `canRead` for many meetings at once, by the same rule (`readable`): one
   * resolve of the member's permissions and one read of the events, however
   * many ids. For a caller with a list to filter, such as AI retrieval
   * (#720). Returns the ids the member may read.
   */
  async readableAmong(
    chapterId: string,
    userId: string,
    meetingIds: readonly string[],
  ): Promise<Set<string>> {
    const ids = [...new Set(meetingIds)];
    if (ids.length === 0) return new Set();
    const [access, found] = await Promise.all([
      this.access(chapterId, userId),
      Promise.all(ids.map((id) => this.meetingRepo.findById(chapterId, id))),
    ]);
    const rows = found.filter((row): row is Meeting => row !== null);
    const pointedAt = access.canEditAny
      ? []
      : rows.flatMap((row) => (row.event_id ? [row.event_id] : []));
    const visibleEventIds = new Set(
      (await this.events.findVisibleByIds(pointedAt, chapterId, userId)).map(
        (event) => event.id,
      ),
    );
    return new Set(
      rows
        .filter((row) =>
          this.readable(row, userId, access, (id) => visibleEventIds.has(id)),
        )
        .map((row) => row.id),
    );
  }

  async get(
    chapterId: string,
    id: string,
    viewerId: string,
  ): Promise<MeetingView> {
    const meeting = await this.meetingRepo.findById(chapterId, id);
    if (!meeting) throw new NotFoundException('Minutes not found');
    const access = await this.access(chapterId, viewerId);
    const event = await this.readableEvent(
      chapterId,
      meeting,
      viewerId,
      access,
    );
    // The same 404 as a missing id, so a reader the event leaves out can't
    // learn that an Exec meeting has minutes.
    if (event === false) throw new NotFoundException('Minutes not found');
    return this.view(chapterId, meeting, event, viewerId, access);
  }

  async start(
    chapterId: string,
    userId: string,
    input: StartMeetingInput,
  ): Promise<MeetingView> {
    const meetingType = this.meetingTypeOf(input.meeting_type);
    const otherLabel = otherLabelFor(meetingType, input.other_label);
    if (!input.event_id === !input.new_event) {
      throw new BadRequestException(
        'Send the meeting’s event_id, or new_event to make one, but not both.',
      );
    }

    let event: Event;
    if (input.event_id) {
      // The viewer's read rule: an officer can't start minutes for an event
      // they can't see.
      event = await this.events.findById(input.event_id, chapterId, userId);
      const existing = await this.meetingRepo.findByEvent(chapterId, event.id);
      if (existing) throw this.alreadyStarted();
    } else {
      event = await this.createEventFor(chapterId, userId, input.new_event!);
    }

    // An event's notes field is where officers wrote minutes before this
    // existed (`events.md` § Event Creation). Starting minutes carries them in,
    // so nothing is typed twice; the event keeps its notes.
    const content: MeetingContent = {
      ...EMPTY_MEETING_CONTENT,
      summary: (event.notes ?? '').slice(0, MEETING_TEXT_MAX_LENGTH),
    };
    const created = await this.meetingRepo.create({
      chapter_id: chapterId,
      event_id: event.id,
      event_name: event.name,
      event_start_time: event.start_time,
      meeting_type: meetingType,
      other_label: otherLabel,
      status: 'draft',
      content: { ...content },
      created_by: userId,
      updated_by: userId,
    });
    if (!created) {
      // Another officer started the same meeting's minutes a moment ago.
      const existing = await this.meetingRepo.findByEvent(chapterId, event.id);
      if (existing) throw this.alreadyStarted();
      throw new ConflictException('These minutes changed. Reload them.');
    }
    return this.view(
      chapterId,
      created,
      event,
      userId,
      await this.access(chapterId, userId),
    );
  }

  async update(
    chapterId: string,
    id: string,
    userId: string,
    input: UpdateMeetingInput,
  ): Promise<MeetingView> {
    const { meeting, access } = await this.editable(chapterId, id, userId);
    const write: MeetingWrite = { updated_by: userId };
    if (input.meeting_type !== undefined) {
      write.meeting_type = this.meetingTypeOf(input.meeting_type);
    }
    const type = write.meeting_type ?? meeting.meeting_type;
    if (input.other_label !== undefined || write.meeting_type !== undefined) {
      write.other_label = otherLabelFor(
        type,
        input.other_label !== undefined
          ? input.other_label
          : meeting.other_label,
      );
    }
    if (input.content) {
      await this.assertOwnersAreMembers(chapterId, input.content);
      write.content = {
        ...readMeetingContent(meeting.content),
        ...pickContent(input.content),
      };
    }
    const event = await this.liveEvent(chapterId, meeting);
    if (event) {
      write.event_name = event.name;
      write.event_start_time = event.start_time;
    }
    const saved = await this.meetingRepo.update(
      chapterId,
      id,
      input.expected_updated_at,
      write,
    );
    if (!saved) throw this.stale();
    return this.view(chapterId, saved, event, userId, access);
  }

  /**
   * Posts a draft: from now on the event's audience reads it, and each of
   * them is told once. Posting minutes that are already posted changes
   * nothing and tells nobody again.
   */
  async post(
    chapterId: string,
    id: string,
    userId: string,
    expectedUpdatedAt: string,
  ): Promise<MeetingView> {
    const { meeting, access } = await this.editable(chapterId, id, userId);
    const event = await this.liveEvent(chapterId, meeting);
    if (meeting.status === 'posted') {
      return this.view(chapterId, meeting, event, userId, access);
    }
    const saved = await this.meetingRepo.update(
      chapterId,
      id,
      expectedUpdatedAt,
      {
        status: 'posted',
        posted_at: new Date().toISOString(),
        posted_by: userId,
        updated_by: userId,
        ...(event
          ? { event_name: event.name, event_start_time: event.start_time }
          : {}),
      },
    );
    if (!saved) throw this.stale();
    if (event) await this.notifyAudience(chapterId, saved, event, userId);
    return this.view(chapterId, saved, event, userId, access);
  }

  async delete(chapterId: string, id: string, userId: string): Promise<void> {
    const meeting = await this.meetingRepo.findById(chapterId, id);
    if (!meeting) return;
    const access = await this.access(chapterId, userId);
    if (!access.canDelete) {
      // Anyone who can't read the minutes gets the 404 a missing id does,
      // the author too once the event no longer shows itself to them.
      if (
        (await this.readableEvent(chapterId, meeting, userId, access)) === false
      ) {
        throw new NotFoundException('Minutes not found');
      }
      const ownDraft =
        meeting.status === 'draft' && meeting.created_by === userId;
      if (ownDraft) {
        await this.meetingRepo.delete(chapterId, id);
        return;
      }
      throw new ForbiddenException(
        'Only someone who can delete minutes can delete these.',
      );
    }
    await this.meetingRepo.delete(chapterId, id);
  }

  async getTemplate(chapterId: string): Promise<MeetingSectionKey[]> {
    const row = await this.meetingRepo.findTemplate(chapterId);
    return normalizeMeetingSections(row?.sections);
  }

  async setTemplate(
    chapterId: string,
    userId: string,
    sections: readonly string[],
  ): Promise<MeetingSectionKey[]> {
    const normalized = normalizeMeetingSections(sections);
    const row = await this.meetingRepo.upsertTemplate(
      chapterId,
      normalized,
      userId,
    );
    return normalizeMeetingSections(row.sections);
  }

  // ── Reading rules ─────────────────────────────────────────────────────────

  /** The viewer's meetings permissions, from one resolve of their set. */
  private async access(
    chapterId: string,
    userId: string,
  ): Promise<ViewerAccess> {
    const held = new Set(
      await this.rbac.getEffectivePermissions(chapterId, userId),
    );
    const has = (permission: string) => held.has('*') || held.has(permission);
    return {
      canEditAny: has(SystemPermissions.MEETINGS_EDIT),
      canDelete: has(SystemPermissions.MEETINGS_DELETE),
    };
  }

  private readable(
    meeting: Meeting,
    viewerId: string,
    access: ViewerAccess,
    eventVisible: (eventId: string) => boolean,
  ): boolean {
    if (access.canEditAny) return true;
    // Minutes whose event is gone are for `meetings:edit` holders alone.
    if (!meeting.event_id || !eventVisible(meeting.event_id)) return false;
    // A draft is its author's until it is posted; the author still has to be
    // someone the event shows itself to.
    return meeting.status === 'posted' || meeting.created_by === viewerId;
  }

  /**
   * The meeting's event as the viewer may read it: the event, `null` when
   * the event is gone but the viewer may still read the minutes, or `false`
   * when the viewer may not read them at all.
   */
  private async readableEvent(
    chapterId: string,
    meeting: Meeting,
    viewerId: string,
    access: ViewerAccess,
  ): Promise<Event | null | false> {
    const event = meeting.event_id
      ? await this.events
          .findById(meeting.event_id, chapterId, viewerId)
          .catch((error: unknown) => {
            if (error instanceof NotFoundException) return null;
            throw error;
          })
      : null;
    const visible = event !== null;
    if (!this.readable(meeting, viewerId, access, () => visible)) return false;
    // A `meetings:edit` holder the event leaves out still reads the minutes,
    // but gets the event through the unscoped read for its name and time.
    if (event) return event;
    return meeting.event_id ? this.liveEvent(chapterId, meeting) : null;
  }

  /** The event row itself, with no viewer rule; `null` when it is gone. */
  private async liveEvent(
    chapterId: string,
    meeting: Meeting,
  ): Promise<Event | null> {
    if (!meeting.event_id) return null;
    return this.events
      .findById(meeting.event_id, chapterId)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
  }

  /**
   * The row, when `userId` may change it; the right refusal otherwise. The
   * author must still be able to read it: an author the event no longer
   * invites, or whose minutes lost their event, gets the 404 any other
   * reader does (§ Who can read minutes).
   */
  private async editable(
    chapterId: string,
    id: string,
    userId: string,
  ): Promise<{ meeting: Meeting; access: ViewerAccess }> {
    const meeting = await this.meetingRepo.findById(chapterId, id);
    if (!meeting) throw new NotFoundException('Minutes not found');
    const access = await this.access(chapterId, userId);
    if (access.canEditAny) return { meeting, access };
    if (
      (await this.readableEvent(chapterId, meeting, userId, access)) === false
    ) {
      throw new NotFoundException('Minutes not found');
    }
    if (meeting.created_by === userId) return { meeting, access };
    throw new ForbiddenException(
      'Only the officer who started these minutes, or someone who can edit any minutes, can change them.',
    );
  }

  /**
   * The minutes, when `userId` may change them; otherwise the refusal a save
   * gives (404 for someone who can't read them, 403 for a reader who isn't
   * their author). The draft-from-notes flow asks this rather than restating
   * who edits minutes.
   */
  async editableBy(
    chapterId: string,
    id: string,
    userId: string,
  ): Promise<Meeting> {
    return (await this.editable(chapterId, id, userId)).meeting;
  }

  private async view(
    chapterId: string,
    meeting: Meeting,
    event: Event | null,
    viewerId: string,
    access: ViewerAccess,
  ): Promise<MeetingView> {
    const sections = await this.getTemplate(chapterId);
    // The check-ins go out only while the chapter shows Attendees: the
    // event's own roster is an officer read (`events:update`), and a chapter
    // that switched the section off chose not to show it to readers.
    const attendees =
      event && sections.includes('attendees')
        ? await this.attendeesOf(event.id)
        : null;
    return {
      meeting,
      content: readMeetingContent(meeting.content),
      sections,
      attendees,
      event_end_time: event?.end_time ?? null,
      can_edit: meeting.created_by === viewerId || access.canEditAny,
      can_delete:
        access.canDelete ||
        (meeting.status === 'draft' && meeting.created_by === viewerId),
    };
  }

  /** The Attendees section: the event's check-ins, filled without typing. */
  private async attendeesOf(eventId: string): Promise<MeetingAttendees> {
    const rows = await this.attendanceRepo.findByEvent(eventId);
    const of = (status: string) =>
      rows.filter((row) => row.status === status).map((row) => row.user_id);
    return { present: of('PRESENT'), late: of('LATE'), excused: of('EXCUSED') };
  }

  // ── Writing helpers ───────────────────────────────────────────────────────

  private meetingTypeOf(value: string): MeetingType {
    if (value === STANDARDS_MEETING_TYPE) {
      // Before any text is stored or sent anywhere (§ Standards meetings).
      throw new BadRequestException({
        code: 'meeting.standards_refused',
        message: STANDARDS_MEETING_REFUSAL,
      });
    }
    if (!isMeetingType(value)) {
      throw new BadRequestException('Unknown meeting type.');
    }
    return value;
  }

  private async createEventFor(
    chapterId: string,
    userId: string,
    input: NonNullable<StartMeetingInput['new_event']>,
  ): Promise<Event> {
    const canCreate = await this.rbac.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.EVENTS_CREATE],
    );
    if (!canCreate) {
      throw new ForbiddenException(
        'Making an event for these minutes needs permission to create events. Pick the meeting’s event instead.',
      );
    }
    const roleIds = [...new Set(input.role_ids ?? [])];
    if (roleIds.length > 0) {
      const roles = await this.rbac.findByChapter(chapterId);
      const known = new Set(roles.map((role) => role.id));
      if (roleIds.some((id) => !known.has(id))) {
        throw new BadRequestException(
          'One of those roles isn’t in this chapter.',
        );
      }
    }
    return this.events.create({
      chapter_id: chapterId,
      name: input.name.trim(),
      start_time: input.start_time,
      end_time: input.end_time,
      point_value: 0,
      is_mandatory: false,
      // Everyone, or only the picked roles, and nobody required.
      others_invited: roleIds.length === 0,
      optional_role_ids: roleIds.length > 0 ? roleIds : null,
      created_by: userId,
      silent: true,
    });
  }

  /**
   * Tells the members the event invites that its minutes are up, leaving out
   * whoever posted them. The text of the minutes is never in the push.
   */
  private async notifyAudience(
    chapterId: string,
    meeting: Meeting,
    event: Event,
    posterId: string,
  ): Promise<void> {
    const members = await this.memberRepo.findByChapter(chapterId);
    const audience = members
      .filter(
        (member) =>
          member.user_id !== posterId && isInvited(event, member.role_ids),
      )
      .map((member) => member.user_id);
    if (audience.length === 0) return;
    await this.notifications.notifyMembers(chapterId, audience, {
      title: 'Minutes posted',
      body: `The minutes from ${event.name} are up.`,
      category: 'events',
      priority: 'NORMAL',
      data: {
        target: { screen: 'events', eventId: event.id, meetingId: meeting.id },
      },
    });
  }

  /** An action item's owner is someone in this chapter, or nobody. */
  private async assertOwnersAreMembers(
    chapterId: string,
    content: MeetingContentPatch,
  ): Promise<void> {
    const owners = new Set(
      (content.action_items ?? []).flatMap((item) =>
        item.owner_user_id ? [item.owner_user_id] : [],
      ),
    );
    if (owners.size === 0) return;
    const members = await this.memberRepo.findByChapter(chapterId);
    const inChapter = new Set(members.map((member) => member.user_id));
    if ([...owners].some((owner) => !inChapter.has(owner))) {
      throw new BadRequestException(
        'An action item’s owner isn’t a member of this chapter.',
      );
    }
  }

  private alreadyStarted(): ConflictException {
    return new ConflictException({
      code: 'meeting.already_started',
      // No id: a draft is its author's, so another officer learns only that
      // minutes exist (§ Who can read minutes).
      message: 'This meeting already has minutes.',
    });
  }

  private stale(): ConflictException {
    return new ConflictException({
      code: 'meeting.stale',
      message:
        'Someone else saved these minutes while you were editing. Reload to see their changes.',
    });
  }
}

function otherLabelFor(
  type: MeetingType,
  label: string | null | undefined,
): string | null {
  if (type !== 'other') return null;
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

/** Only the known sections of a patch, so a stray key is never stored. */
function pickContent(patch: MeetingContentPatch): MeetingContentPatch {
  const out: MeetingContentPatch = {};
  if (patch.summary !== undefined) out.summary = patch.summary;
  if (patch.announcements !== undefined)
    out.announcements = patch.announcements;
  if (patch.decisions !== undefined) out.decisions = patch.decisions;
  if (patch.action_items !== undefined) out.action_items = patch.action_items;
  if (patch.officer_reports !== undefined) {
    out.officer_reports = patch.officer_reports;
  }
  if (patch.old_business !== undefined) out.old_business = patch.old_business;
  if (patch.new_business !== undefined) out.new_business = patch.new_business;
  if (patch.discussion_log !== undefined) {
    out.discussion_log = patch.discussion_log;
  }
  return out;
}
