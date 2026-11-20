import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { MEETING_NO_MINUTES_REPOSITORY } from '#domain/repositories/meeting-no-minutes.repository.interface';
import type { IMeetingNoMinutesRepository } from '#domain/repositories/meeting-no-minutes.repository.interface';
import { EventService } from './event.service';
import { MeetingService } from './meeting.service';

/**
 * An officer marks a meeting that ended without minutes as "No minutes"
 * (Paul, 2026-11-20: "can I say we don't have minutes? should be a valid
 * option"), so the Meetings list stops asking for them
 * (`spec/behavior/meetings.md` § Meetings, tied to their events).
 *
 * The controller gates every route on `meetings:record`, the permission
 * that starts minutes. The event must be one the officer can see (a hidden
 * one 404s like a missing id), it must have ended, and it must have no
 * minutes. Starting minutes on a marked event drops the mark (a trigger on
 * `meetings`), so minutes always win.
 */
@Injectable()
export class MeetingNoMinutesService {
  constructor(
    @Inject(MEETING_NO_MINUTES_REPOSITORY)
    private readonly marks: IMeetingNoMinutesRepository,
    private readonly events: EventService,
    private readonly meetings: MeetingService,
  ) {}

  /**
   * The event ids marked "No minutes" among the events this officer can
   * see: a role-targeted meeting they aren't cleared for stays unconfirmed,
   * as `EventService.findById` keeps it.
   */
  async list(chapterId: string, userId: string): Promise<string[]> {
    const rows = await this.marks.list(chapterId);
    const visible = await this.events.findVisibleByIds(
      rows.map((row) => row.event_id),
      chapterId,
      userId,
    );
    return visible.map((event) => event.id);
  }

  async mark(
    chapterId: string,
    userId: string,
    eventId: string,
    now = Date.now(),
  ): Promise<void> {
    const event = await this.events.findById(eventId, chapterId, userId);
    const end = Date.parse(event.end_time ?? event.start_time);
    if (!(end <= now)) {
      throw new ConflictException({
        code: 'meeting.not_over',
        message: 'This meeting hasn’t happened yet.',
      });
    }
    if (await this.meetings.hasMinutesFor(chapterId, event.id)) {
      throw new ConflictException({
        code: 'meeting.already_started',
        message: 'This meeting already has minutes.',
      });
    }
    await this.marks.mark(chapterId, event.id, userId);
    // Minutes that started between the check and the mark fired the trigger
    // before the mark existed, so drop it here: minutes always win.
    if (await this.meetings.hasMinutesFor(chapterId, event.id)) {
      await this.marks.unmark(chapterId, event.id);
      throw new ConflictException({
        code: 'meeting.already_started',
        message: 'This meeting already has minutes.',
      });
    }
  }

  async unmark(
    chapterId: string,
    userId: string,
    eventId: string,
  ): Promise<void> {
    const event = await this.events.findById(eventId, chapterId, userId);
    await this.marks.unmark(chapterId, event.id);
  }
}
