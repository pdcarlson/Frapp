import { NewEventSuggestionKind } from './ai-suggestion-new-event-kind';
import type { EventService } from './event.service';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OFFICER = '22222222-2222-4222-8222-222222222222';

function build() {
  const events = { create: jest.fn(async () => ({ id: 'event-1' })) };
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
