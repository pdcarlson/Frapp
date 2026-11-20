import { NotFoundException } from '@nestjs/common';
import {
  DATE_REMINDER_SWEEP_BATCH,
  MeetingDateReminderSweepService,
  writtenDay,
} from './meeting-date-reminder-sweep.service';
import type { MeetingDateReminder } from '#domain/repositories/meeting-date-reminder.repository.interface';
import type { MeetingService } from '../services/meeting.service';
import type { NotificationService } from '../services/notification.service';

const NOW = Date.parse('2026-12-03T23:00:30.000Z');

const row = (
  overrides: Partial<MeetingDateReminder> = {},
): MeetingDateReminder => ({
  id: 'rem-1',
  user_id: 'user-1',
  chapter_id: 'chap-1',
  meeting_id: 'meet-1',
  day: '2026-12-04',
  text: 'Winter formal',
  remind_at: '2026-12-03T23:00:00.000Z',
  created_at: '2026-11-20T00:00:00.000Z',
  updated_at: '2026-11-20T00:00:00.000Z',
  ...overrides,
});

function build(
  due: MeetingDateReminder[],
  options: { claims?: boolean; readable?: boolean } = {},
) {
  const reminders = {
    upsert: jest.fn(),
    delete: jest.fn(),
    findByUserAndMeeting: jest.fn(),
    findDue: jest.fn().mockResolvedValueOnce(due).mockResolvedValue([]),
    claimDue: jest.fn().mockResolvedValue(options.claims ?? true),
  };
  const meetings = {
    get: jest
      .fn()
      .mockImplementation(() =>
        options.readable === false
          ? Promise.reject(new NotFoundException('Minutes not found'))
          : Promise.resolve({ meeting: { id: 'meet-1', event_id: 'ev-1' } }),
      ),
  };
  const notifications = { notifyUser: jest.fn().mockResolvedValue(undefined) };
  const sweep = new MeetingDateReminderSweepService(
    reminders,
    meetings as unknown as MeetingService,
    notifications as unknown as NotificationService,
  );
  return { sweep, reminders, notifications };
}

describe('MeetingDateReminderSweepService', () => {
  it('pushes the date written out, opening the minutes', async () => {
    const { sweep, reminders, notifications } = build([row()]);
    await expect(sweep.sweep(NOW)).resolves.toEqual({ fired: 1, pushed: 1 });
    expect(reminders.claimDue).toHaveBeenCalledWith(row());
    expect(notifications.notifyUser).toHaveBeenCalledWith(
      'user-1',
      'chap-1',
      expect.objectContaining({
        title: 'Reminder',
        body: 'Friday, December 4: Winter formal',
        category: 'reminder',
        data: {
          target: { screen: 'events', eventId: 'ev-1', meetingId: 'meet-1' },
          reminder: true,
        },
      }),
    );
  });

  it('sends nothing for a reminder another replica claimed, or one moved since the read', async () => {
    const { sweep, notifications } = build([row()], { claims: false });
    await expect(sweep.sweep(NOW)).resolves.toEqual({ fired: 0, pushed: 0 });
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('sends nothing for minutes the member can no longer read', async () => {
    const { sweep, notifications } = build([row()], { readable: false });
    await expect(sweep.sweep(NOW)).resolves.toEqual({ fired: 1, pushed: 0 });
    expect(notifications.notifyUser).not.toHaveBeenCalled();
  });

  it('keeps going after one push fails', async () => {
    const { sweep, notifications } = build([row(), row({ id: 'rem-2' })]);
    notifications.notifyUser.mockRejectedValueOnce(new Error('expo down'));
    await expect(sweep.sweep(NOW)).resolves.toEqual({ fired: 2, pushed: 1 });
  });

  it('reads again while a read comes back full', async () => {
    const full = Array.from({ length: DATE_REMINDER_SWEEP_BATCH }, (_, i) =>
      row({ id: `rem-${i}` }),
    );
    const { sweep, reminders } = build(full);
    await sweep.sweep(NOW);
    expect(reminders.findDue).toHaveBeenCalledTimes(2);
  });
});

describe('writtenDay', () => {
  it('reads the day as a calendar day, whatever the server’s time zone', () => {
    expect(writtenDay('2026-12-04')).toBe('Friday, December 4');
    expect(writtenDay('not a day')).toBe('not a day');
  });
});
