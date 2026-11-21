import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MeetingDateReminderService } from './meeting-date-reminder.service';
import type { MeetingDateReminder } from '#domain/repositories/meeting-date-reminder.repository.interface';
import type { MeetingService } from './meeting.service';

const CHAPTER = 'chap-1';
const USER = 'user-1';
const MEETING = 'meet-1';
const NOW = new Date('2026-11-20T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const row = (
  overrides: Partial<MeetingDateReminder> = {},
): MeetingDateReminder => ({
  id: 'rem-1',
  user_id: USER,
  chapter_id: CHAPTER,
  meeting_id: MEETING,
  day: '2026-12-04',
  text: 'Winter formal',
  remind_at: '2026-12-03T23:00:00.000Z',
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...overrides,
});

function build(options: { readable?: boolean } = {}) {
  const reminders = {
    upsert: jest
      .fn()
      .mockImplementation((input) =>
        Promise.resolve(
          row({ day: input.day, text: input.text, remind_at: input.remindAt }),
        ),
      ),
    delete: jest.fn().mockResolvedValue(undefined),
    findByUserAndMeeting: jest.fn().mockResolvedValue([row()]),
    findDue: jest.fn(),
    claimDue: jest.fn(),
  };
  const readable = options.readable ?? true;
  const meetings = {
    canRead: jest.fn().mockResolvedValue(readable),
    get: jest.fn().mockImplementation(() =>
      readable
        ? Promise.resolve({
            meeting: { id: MEETING, event_id: 'ev-1' },
            content: {
              dates: [
                { date: '2026-12-04', text: 'Winter formal' },
                { date: '2026-12-06', text: 'Dues to the treasurer' },
              ],
            },
          })
        : Promise.reject(new NotFoundException('Minutes not found')),
    ),
  };
  const service = new MeetingDateReminderService(
    reminders,
    meetings as unknown as MeetingService,
  );
  return { service, reminders, meetings };
}

describe('MeetingDateReminderService', () => {
  it('sets a reminder on a date the minutes give, for the caller', async () => {
    const { service, reminders } = build();
    const at = new Date(NOW.getTime() + 24 * HOUR);
    const ref = await service.set(
      CHAPTER,
      USER,
      MEETING,
      { date: '2026-12-04', text: ' Winter formal ', remindAt: at },
      NOW,
    );
    expect(reminders.upsert).toHaveBeenCalledWith({
      userId: USER,
      chapterId: CHAPTER,
      meetingId: MEETING,
      day: '2026-12-04',
      text: 'Winter formal',
      remindAt: at.toISOString(),
    });
    expect(ref).toEqual({
      id: 'rem-1',
      date: '2026-12-04',
      text: 'Winter formal',
      remind_at: at.toISOString(),
    });
  });

  it('refuses a date the minutes no longer give, so a push never quotes other words', async () => {
    const { service, reminders } = build();
    await expect(
      service.set(
        CHAPTER,
        USER,
        MEETING,
        {
          date: '2026-12-05',
          text: 'Winter formal',
          remindAt: new Date(NOW.getTime() + HOUR),
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(reminders.upsert).not.toHaveBeenCalled();
  });

  it('answers a reader the minutes leave out with the 404 a missing id gets', async () => {
    const { service, reminders } = build({ readable: false });
    await expect(
      service.set(
        CHAPTER,
        USER,
        MEETING,
        {
          date: '2026-12-04',
          text: 'Winter formal',
          remindAt: new Date(NOW.getTime() + HOUR),
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list(CHAPTER, USER, MEETING)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(reminders.upsert).not.toHaveBeenCalled();
    expect(reminders.findByUserAndMeeting).not.toHaveBeenCalled();
  });

  it.each([
    ['in the past', new Date(NOW.getTime() - HOUR)],
    ['over a year ahead', new Date(NOW.getTime() + 400 * 24 * HOUR)],
    ['not a time', new Date('nope')],
  ])('refuses a time %s', async (_label, remindAt) => {
    const { service, meetings } = build();
    await expect(
      service.set(
        CHAPTER,
        USER,
        MEETING,
        { date: '2026-12-04', text: 'Winter formal', remindAt },
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(meetings.get).not.toHaveBeenCalled();
  });

  it('lists only the caller’s own reminders on these minutes', async () => {
    const { service, reminders } = build();
    await expect(service.list(CHAPTER, USER, MEETING)).resolves.toEqual([
      {
        id: 'rem-1',
        date: '2026-12-04',
        text: 'Winter formal',
        remind_at: '2026-12-03T23:00:00.000Z',
      },
    ]);
    expect(reminders.findByUserAndMeeting).toHaveBeenCalledWith(
      USER,
      CHAPTER,
      MEETING,
    );
  });

  it('cancels without reading the minutes, so a member who lost them can still cancel', async () => {
    const { service, reminders, meetings } = build({ readable: false });
    await service.clear(CHAPTER, USER, MEETING, 'rem-1');
    expect(reminders.delete).toHaveBeenCalledWith(
      USER,
      CHAPTER,
      MEETING,
      'rem-1',
    );
    expect(meetings.get).not.toHaveBeenCalled();
  });
});
