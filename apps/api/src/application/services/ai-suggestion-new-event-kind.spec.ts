import { NewEventSuggestionKind } from './ai-suggestion-new-event-kind';
import type { EventService } from './event.service';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '22222222-2222-4222-8222-222222222222';

const MADE = '33333333-3333-4333-8333-333333333333';
const SERIES = 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU;COUNT=13;TZID=America/New_York';

function build(made: { id: string; created_by: string } | null = null) {
  const events = {
    create: jest.fn(async () => ({ id: 'event-1' })),
    findById: jest.fn(async () => {
      if (!made) throw new Error('Event not found');
      return made;
    }),
  };
  return {
    kind: new NewEventSuggestionKind(events as unknown as EventService),
    events,
  };
}

const proposal = (extra: Record<string, unknown> = {}) => ({
  name: 'Study night',
  description: null,
  location: 'Library',
  start_time: '2026-11-18T00:00:00.000Z',
  end_time: '2026-11-18T01:00:00.000Z',
  point_value: null,
  is_mandatory: false,
  recurrence_rule: null,
  ...extra,
});

describe('NewEventSuggestionKind', () => {
  it('needs the permission and module of the create-event route', () => {
    const { kind } = build();
    expect(kind.requiredPermission).toBe('events:create');
    expect(kind.module).toBe('events');
    expect(kind.expiresAfterDays).toBe(1);
  });

  it('keeps a well-formed proposal', () => {
    const { kind } = build();
    expect(kind.normalizeProposal(proposal())).toEqual(proposal());
  });

  it.each([
    [proposal({ name: '  ' })],
    [proposal({ start_time: 'Tuesday' })],
    [proposal({ end_time: '2026-11-17T23:00:00.000Z' })],
    [proposal({ start_time: 'x'.repeat(500) })],
    ['an event'],
  ])('turns down %j', (raw) => {
    const { kind } = build();
    expect(kind.normalizeProposal(raw)).toBeNull();
  });

  it('drops a points value that is not a whole number from 0 up', () => {
    const { kind } = build();
    expect(kind.normalizeProposal(proposal({ point_value: -5 }))).toMatchObject(
      {
        point_value: null,
      },
    );
    expect(kind.normalizeProposal(proposal({ point_value: 10 }))).toMatchObject(
      {
        point_value: 10,
      },
    );
  });

  it('refuses an edit that ends the event before it starts', () => {
    const { kind } = build();
    expect(() =>
      kind.applyEdits(proposal(), { end_time: '2026-11-17T00:00:00.000Z' }),
    ).toThrow('An event ends after it starts.');
    expect(kind.applyEdits(proposal(), { name: 'Study hall' })).toMatchObject({
      name: 'Study hall',
    });
  });

  it('creates the event through the event service as the officer, with no chat card', async () => {
    const { kind, events } = build();
    expect(
      await kind.commit({
        chapterId: CHAPTER,
        userId: OFFICER,
        payload: proposal({ is_mandatory: true }),
      }),
    ).toEqual({ resultId: 'event-1' });
    expect(events.create).toHaveBeenCalledWith({
      chapter_id: CHAPTER,
      created_by: OFFICER,
      name: 'Study night',
      description: null,
      location: 'Library',
      start_time: '2026-11-18T00:00:00.000Z',
      end_time: '2026-11-18T01:00:00.000Z',
      is_mandatory: true,
    });
  });

  it('keeps a repeat the event form can make, and drops anything else', () => {
    const { kind } = build();
    expect(
      kind.normalizeProposal(proposal({ recurrence_rule: SERIES })),
    ).toMatchObject({ recurrence_rule: SERIES });
    expect(
      kind.normalizeProposal(proposal({ recurrence_rule: 'every tuesday' })),
    ).toMatchObject({ recurrence_rule: null });
  });

  it('makes a series through the event service when the proposal repeats', async () => {
    const { kind, events } = build();
    await kind.commit({
      chapterId: CHAPTER,
      userId: OFFICER,
      payload: proposal({ recurrence_rule: SERIES }),
    });
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ recurrence_rule: SERIES }),
    );
  });

  describe("made in the event form (the card's Edit)", () => {
    it('records the event the member made and makes nothing', async () => {
      const { kind, events } = build({ id: MADE, created_by: OFFICER });
      const accepted = kind.applyEdits(proposal(), { event_id: MADE });
      expect(() => kind.assertAcceptable(accepted)).not.toThrow();
      expect(kind.countsAsEdited(proposal(), accepted)).toBe(true);
      expect(
        await kind.commit({
          chapterId: CHAPTER,
          userId: OFFICER,
          payload: accepted,
        }),
      ).toEqual({ resultId: MADE });
      expect(events.findById).toHaveBeenCalledWith(MADE, CHAPTER);
      expect(events.create).not.toHaveBeenCalled();
    });

    it("answers not found for someone else's event, as the event route does", async () => {
      const { kind, events } = build({ id: MADE, created_by: 'someone-else' });
      await expect(
        kind.commit({
          chapterId: CHAPTER,
          userId: OFFICER,
          payload: kind.applyEdits(proposal(), { event_id: MADE }),
        }),
      ).rejects.toThrow('Event not found');
      expect(events.create).not.toHaveBeenCalled();
    });

    it('refuses an id that is not one', () => {
      const { kind } = build();
      expect(() => kind.applyEdits(proposal(), { event_id: 'x' })).toThrow(
        'Add the event from its form first.',
      );
    });

    it('never takes an event id from a proposal', () => {
      const { kind } = build();
      expect(
        kind.normalizeProposal(proposal({ event_id: MADE })),
      ).not.toHaveProperty('event_id');
    });
  });

  it("passes a points value only when one was said, leaving the service's default otherwise", async () => {
    const { kind, events } = build();
    await kind.commit({
      chapterId: CHAPTER,
      userId: OFFICER,
      payload: proposal({ point_value: 20 }),
    });
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ point_value: 20 }),
    );
  });
});
