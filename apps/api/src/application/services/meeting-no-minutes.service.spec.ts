import { ConflictException, NotFoundException } from '@nestjs/common';
import { MeetingNoMinutesService } from './meeting-no-minutes.service';
import type { EventService } from './event.service';
import type { MeetingService } from './meeting.service';
import type { IMeetingNoMinutesRepository } from '#domain/repositories/meeting-no-minutes.repository.interface';

const NOW = Date.parse('2026-11-20T06:00:00Z');

function setup(
  event: { id: string; start_time: string; end_time: string } | null,
  hasMinutes: boolean | boolean[] = false,
  visible: string[] = ['e1'],
) {
  const marks: jest.Mocked<IMeetingNoMinutesRepository> = {
    list: jest.fn().mockResolvedValue([
      {
        event_id: 'e1',
        chapter_id: 'c',
        marked_by: 'u',
        created_at: '2026-11-19T00:00:00Z',
      },
    ]),
    mark: jest.fn().mockResolvedValue(undefined),
    unmark: jest.fn().mockResolvedValue(undefined),
  };
  const events = {
    findById: jest.fn(() =>
      event
        ? Promise.resolve(event)
        : Promise.reject(new NotFoundException('Event not found')),
    ),
    findVisibleByIds: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.filter((id) => visible.includes(id)).map((id) => ({ id })),
      ),
    ),
  } as unknown as EventService;
  const answers = Array.isArray(hasMinutes) ? [...hasMinutes] : null;
  const meetings = {
    hasMinutesFor: jest.fn(() =>
      Promise.resolve(answers ? (answers.shift() ?? false) : hasMinutes),
    ),
  } as unknown as MeetingService;
  return {
    marks,
    events,
    service: new MeetingNoMinutesService(marks, events, meetings),
  };
}

const ended = {
  id: 'e1',
  start_time: '2026-11-19T20:00:00Z',
  end_time: '2026-11-19T21:00:00Z',
};

describe('MeetingNoMinutesService', () => {
  it('lists the marked event ids the caller can see', async () => {
    const { service, events } = setup(ended);
    await expect(service.list('c', 'u')).resolves.toEqual(['e1']);
    expect(events.findVisibleByIds).toHaveBeenCalledWith(['e1'], 'c', 'u');
  });

  it('leaves out a marked event the caller is not cleared to see', async () => {
    const { service } = setup(ended, false, []);
    await expect(service.list('c', 'u')).resolves.toEqual([]);
  });

  it('drops its own mark when minutes started while it was being made', async () => {
    const { service, marks } = setup(ended, [false, true]);
    await expect(service.mark('c', 'u', 'e1', NOW)).rejects.toMatchObject({
      response: { code: 'meeting.already_started' },
    });
    expect(marks.mark).toHaveBeenCalledWith('c', 'e1', 'u');
    expect(marks.unmark).toHaveBeenCalledWith('c', 'e1');
  });

  it('marks a meeting that ended with no minutes, read as the caller', async () => {
    const { service, marks, events } = setup(ended);
    await service.mark('c', 'u', 'e1', NOW);
    expect(events.findById).toHaveBeenCalledWith('e1', 'c', 'u');
    expect(marks.mark).toHaveBeenCalledWith('c', 'e1', 'u');
  });

  it('refuses a meeting that has not ended', async () => {
    const { service, marks } = setup({
      ...ended,
      end_time: '2026-11-20T07:00:00Z',
    });
    await expect(service.mark('c', 'u', 'e1', NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(marks.mark).not.toHaveBeenCalled();
  });

  it('refuses a meeting that already has minutes', async () => {
    const { service, marks } = setup(ended, true);
    await expect(service.mark('c', 'u', 'e1', NOW)).rejects.toMatchObject({
      response: { code: 'meeting.already_started' },
    });
    expect(marks.mark).not.toHaveBeenCalled();
  });

  it('answers an event the caller cannot see with not found', async () => {
    const { service, marks } = setup(null);
    await expect(service.mark('c', 'u', 'e1', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.unmark('c', 'u', 'e1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(marks.unmark).not.toHaveBeenCalled();
  });

  it('takes a mark off', async () => {
    const { service, marks } = setup(ended);
    await service.unmark('c', 'u', 'e1');
    expect(marks.unmark).toHaveBeenCalledWith('c', 'e1');
  });
});
