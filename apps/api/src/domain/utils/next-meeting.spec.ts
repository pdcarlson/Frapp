import type { Event } from '../entities/event.entity';
import { isSameMeetingKind, nextMeetingOf } from './next-meeting';

const audience = (event: Event) =>
  `${(event.required_role_ids ?? []).join(',')}|${String(event.others_invited)}`;

const event = (id: string, over: Partial<Event> = {}): Event =>
  ({
    id,
    name: 'Chapter Meeting',
    start_time: '2026-11-22T19:00:00.000Z',
    event_type_id: null,
    recurrence_rule: null,
    parent_event_id: null,
    required_role_ids: [],
    others_invited: null,
    ...over,
  }) as Event;

const NOW = new Date('2026-11-20T12:00:00.000Z');

describe('next meeting (#5790)', () => {
  it('matches the same type and audience, and nothing with other people', () => {
    const source = event('src', { event_type_id: 'type-chapter' });
    expect(
      isSameMeetingKind(
        source,
        event('a', { event_type_id: 'type-chapter' }),
        audience,
      ),
    ).toBe(true);
    expect(
      isSameMeetingKind(
        source,
        event('b', { event_type_id: 'type-social' }),
        audience,
      ),
    ).toBe(false);
    expect(
      isSameMeetingKind(
        source,
        event('c', {
          event_type_id: 'type-chapter',
          required_role_ids: ['exec'],
          others_invited: false,
        }),
        audience,
      ),
    ).toBe(false);
  });

  it('falls back to the series, then the name, when the meeting has no type', () => {
    const occurrence = event('occ-1', { parent_event_id: 'series-1' });
    expect(
      isSameMeetingKind(
        occurrence,
        event('occ-2', { parent_event_id: 'series-1' }),
        audience,
      ),
    ).toBe(true);
    expect(
      isSameMeetingKind(
        occurrence,
        event('other', { name: 'Chapter Meeting' }),
        audience,
      ),
    ).toBe(false);
    expect(
      isSameMeetingKind(
        event('one-off'),
        event('later', { name: ' chapter  meeting ' }),
        audience,
      ),
    ).toBe(true);
  });

  it('picks the earliest that hasn’t started, never the source itself', () => {
    const source = event('src', { start_time: '2026-11-15T19:00:00.000Z' });
    const next = nextMeetingOf(
      source,
      [
        source,
        event('started', { start_time: '2026-11-20T11:00:00.000Z' }),
        event('later', { start_time: '2026-11-29T19:00:00.000Z' }),
        event('soonest', { start_time: '2026-11-22T19:00:00.000Z' }),
      ],
      NOW,
      audience,
    );
    expect(next?.id).toBe('soonest');
    expect(nextMeetingOf(source, [source], NOW, audience)).toBeNull();
  });
});
