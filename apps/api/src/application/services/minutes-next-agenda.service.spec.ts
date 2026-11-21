import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EventAgendaItem } from '@repo/validation';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import type { Event } from '#domain/entities/event.entity';
import type {
  MeetingNextAgendaItem,
  MeetingNextAgendaItemMove,
  NewMeetingNextAgendaItem,
} from '#domain/entities/meeting-next-agenda-item.entity';
import {
  MinutesNextAgendaService,
  nextAgendaItemIdOf,
} from './minutes-next-agenda.service';

const CHAPTER = 'chapter-1';
const OFFICER = 'officer-1';
const NOW = new Date('2026-11-20T12:00:00.000Z');

const event = (id: string, over: Partial<Event> = {}): Event =>
  ({
    id,
    chapter_id: CHAPTER,
    name: 'Chapter Meeting',
    start_time: '2026-11-22T19:00:00.000Z',
    end_time: '2026-11-22T20:30:00.000Z',
    event_type_id: 'type-chapter',
    recurrence_rule: null,
    parent_event_id: null,
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
    others_invited: null,
    agenda: [],
    ...over,
  }) as Event;

const suggestion = (over: Partial<AiSuggestion> = {}): AiSuggestion =>
  ({
    id: 'sugg-1',
    kind: 'task',
    source_type: 'meeting',
    source_id: 'minutes-1',
    payload: { title: 'Plan 2 to 3 backup activities' },
    quote:
      'Plan 2 to 3 backup activities for each rush event in case it slows down.',
    ...over,
  }) as AiSuggestion;

class FakeItems {
  rows: MeetingNextAgendaItem[] = [];
  insert = jest.fn(async (row: NewMeetingNextAgendaItem) => {
    const saved = { ...row, created_at: NOW.toISOString() };
    this.rows.push(saved);
    return saved;
  });
  delete = jest.fn(async (_c: string, id: string) => {
    this.rows = this.rows.filter((row) => row.id !== id);
  });
  findBySuggestion = jest.fn(
    async (_c: string, id: string) =>
      this.rows.find((row) => row.ai_suggestion_id === id) ?? null,
  );
  listOffered = jest.fn(async () => []);
  listWaiting = jest.fn(async () =>
    this.rows.filter((row) => row.state === 'waiting'),
  );
  moveWaiting = jest.fn(
    async (_c: string, id: string, move: MeetingNextAgendaItemMove) => {
      const row = this.rows.find((r) => r.id === id && r.state === 'waiting');
      if (!row) return false;
      Object.assign(row, move, {
        agenda_item_id: move.state === 'placed' ? move.agenda_item_id : null,
        expires_at: null,
      });
      return true;
    },
  );
  deleteExpired = jest.fn(async () => 0);
  listWaitingChapters = jest.fn(async () => [CHAPTER]);
  forgetWords = jest.fn(async () => 0);
}

function setup(options: {
  events: Event[];
  mayEdit?: boolean;
  hidden?: string[];
  full?: boolean;
}) {
  const byId = new Map(options.events.map((e) => [e.id, e]));
  const events = {
    onCreated: jest.fn(),
    findById: jest.fn(async (id: string, _c: string, viewer?: string) => {
      const found = byId.get(id);
      if (!found || (viewer && options.hidden?.includes(id))) {
        throw new NotFoundException('Event not found');
      }
      return found;
    }),
    findByChapter: jest.fn(async () => [...byId.values()]),
    appendAgendaItem: jest.fn(
      async (id: string, _c: string, item: EventAgendaItem) => {
        if (options.full) throw new ConflictException('full');
        const target = byId.get(id)!;
        target.agenda = [...(target.agenda ?? []), item];
        return target.agenda;
      },
    ),
    removeAgendaItem: jest.fn(async (id: string, _c: string, item: string) => {
      const target = byId.get(id)!;
      target.agenda = (target.agenda ?? []).filter((e) => e.id !== item);
      return target.agenda;
    }),
  };
  const meetings = {
    get: jest.fn(async () => ({
      meeting: { id: 'minutes-1', event_id: 'evt-last' },
    })),
  };
  const rbac = {
    memberHasAnyPermission: jest.fn(async () => options.mayEdit ?? true),
  };
  // The decision itself is `AiSuggestionService`'s (its own spec): here it
  // only runs the handling against one suggestion.
  const suggestions = {
    handleElsewhere: jest.fn(
      async (
        _c: string,
        _u: string,
        _id: string,
        handling: {
          accepts: (r: AiSuggestion) => boolean;
          findMade: (r: AiSuggestion) => Promise<unknown>;
          make: (r: AiSuggestion) => Promise<unknown>;
        },
      ) => {
        const row = suggestion();
        if (!handling.accepts(row)) throw new Error('not handled here');
        return (await handling.findMade(row)) ?? handling.make(row);
      },
    ),
    undoHandled: jest.fn(
      async (
        _c: string,
        _u: string,
        _id: string,
        handling: {
          findMade: (r: AiSuggestion) => Promise<unknown>;
          mayUndo: (m: unknown) => Promise<void>;
          wordsOf: (m: unknown) => unknown;
          unmake: (m: unknown) => Promise<void>;
        },
      ) => {
        const made = await handling.findMade(suggestion());
        if (!made) return;
        await handling.mayUndo(made);
        undone.push(handling.wordsOf(made));
        await handling.unmake(made);
      },
    ),
  };
  const items = new FakeItems();
  const undone: unknown[] = [];
  const added = { keys: new Set<string>() };
  const service = new MinutesNextAgendaService(
    suggestions as never,
    events as never,
    meetings as never,
    rbac as never,
    items,
    { addedKeys: jest.fn(async () => added.keys) },
  );
  service.now = () => NOW;
  return { service, events, items, byId, rbac, undone, added };
}

const last = event('evt-last', {
  start_time: '2026-11-15T19:00:00.000Z',
  end_time: '2026-11-15T20:30:00.000Z',
});

describe('MinutesNextAgendaService (#5790)', () => {
  it('adds the item straight onto the next meeting of the same kind', async () => {
    const { service, byId, items } = setup({
      events: [
        last,
        event('evt-social', {
          event_type_id: 'type-social',
          start_time: '2026-11-21T19:00:00.000Z',
        }),
        event('evt-next'),
        event('evt-after', { start_time: '2026-11-29T19:00:00.000Z' }),
      ],
    });
    const outcome = await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    expect(outcome.item.state).toBe('placed');
    expect(outcome.event?.id).toBe('evt-next');
    expect(byId.get('evt-next')!.agenda).toEqual([
      {
        id: nextAgendaItemIdOf('sugg-1'),
        text: 'Plan 2 to 3 backup activities for each rush event in case it slows down.',
        done: false,
      },
    ]);
    expect(byId.get('evt-social')!.agenda).toEqual([]);
    // The suggestion's words are kept for Undo.
    expect(items.rows[0]).toMatchObject({
      suggestion_payload: { title: 'Plan 2 to 3 backup activities' },
      created_by: OFFICER,
    });
  });

  it('offers it under Suggested on that meeting when the officer can’t edit it', async () => {
    const { service, byId } = setup({
      events: [last, event('evt-next')],
      mayEdit: false,
    });
    const outcome = await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    expect(outcome.item.state).toBe('offered');
    expect(outcome.event?.id).toBe('evt-next');
    expect(byId.get('evt-next')!.agenda).toEqual([]);
  });

  it('offers it, and names no meeting, when the officer can’t see the next one', async () => {
    const { service, byId } = setup({
      events: [last, event('evt-next')],
      hidden: ['evt-next'],
    });
    const outcome = await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    expect(outcome.item.state).toBe('offered');
    expect(outcome.event).toBeNull();
    expect(byId.get('evt-next')!.agenda).toEqual([]);
  });

  it('places a waiting item for its sender only if they can edit the new meeting', async () => {
    const { service, byId, items, rbac } = setup({ events: [last] });
    await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    rbac.memberHasAnyPermission.mockResolvedValue(false);
    byId.set('evt-new', event('evt-new'));
    expect(await service.placeWaiting(CHAPTER)).toBe(1);
    expect(items.rows[0]).toMatchObject({
      state: 'offered',
      event_id: 'evt-new',
    });
    expect(byId.get('evt-new')!.agenda).toEqual([]);
  });

  it('places waiting items whenever an event is created (#5790 wiring)', async () => {
    const { service, events } = setup({ events: [last] });
    service.onModuleInit();
    const placeWaiting = jest
      .spyOn(service, 'placeWaiting')
      .mockResolvedValue(0);
    const listener = events.onCreated.mock.calls[0][0] as (
      chapterId: string,
      event: Event,
    ) => Promise<void>;
    await listener(CHAPTER, event('evt-new'));
    expect(placeWaiting).toHaveBeenCalledWith(CHAPTER);
  });

  it('refuses Undo to an officer who can’t edit the meeting it went on', async () => {
    const { service, byId, rbac } = setup({
      events: [last, event('evt-next')],
    });
    await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    rbac.memberHasAnyPermission.mockResolvedValue(false);
    await expect(
      service.undo(CHAPTER, 'member-2', 'sugg-1'),
    ).rejects.toMatchObject({ status: 403 });
    expect(byId.get('evt-next')!.agenda).toHaveLength(1);
  });

  it('refuses Undo of an offered item another officer already added', async () => {
    const { service, items, added } = setup({
      events: [last, event('evt-next')],
      mayEdit: false,
    });
    await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    added.keys = new Set([`minutes:${items.rows[0].id}`]);
    await expect(
      service.undo(CHAPTER, OFFICER, 'sugg-1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(items.rows).toHaveLength(1);
  });

  it('offers it when the next meeting’s agenda is full', async () => {
    const { service } = setup({
      events: [last, event('evt-next')],
      full: true,
    });
    const outcome = await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    expect(outcome.item.state).toBe('offered');
  });

  it('waits 30 days for the next meeting, then lands on it when it is created', async () => {
    const { service, byId, items } = setup({ events: [last] });
    const outcome = await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    expect(outcome.item.state).toBe('waiting');
    expect(outcome.event).toBeNull();
    expect(outcome.sourceName).toBe('Chapter Meeting');
    expect(outcome.item.expires_at).toBe('2026-12-20T12:00:00.000Z');

    // An unrelated event changes nothing.
    byId.set(
      'evt-social',
      event('evt-social', { event_type_id: 'type-social' }),
    );
    expect(await service.placeWaiting(CHAPTER)).toBe(0);

    byId.set('evt-new', event('evt-new'));
    expect(await service.placeWaiting(CHAPTER)).toBe(1);
    expect(items.rows[0]).toMatchObject({
      state: 'placed',
      event_id: 'evt-new',
      expires_at: null,
    });
    expect(byId.get('evt-new')!.agenda?.map((item) => item.text)).toEqual([
      'Plan 2 to 3 backup activities for each rush event in case it slows down.',
    ]);
  });

  it('answers a second send with where the first one went, adding nothing', async () => {
    const { service, byId } = setup({ events: [last, event('evt-next')] });
    await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    const again = await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    expect(again.item.state).toBe('placed');
    expect(again.event?.id).toBe('evt-next');
    expect(byId.get('evt-next')!.agenda).toHaveLength(1);
  });

  it('undoes: takes the item back off the meeting and hands back the suggestion’s words', async () => {
    const { service, byId, items, undone } = setup({
      events: [last, event('evt-next')],
    });
    await service.send(CHAPTER, OFFICER, 'sugg-1', null);
    await service.undo(CHAPTER, OFFICER, 'sugg-1');
    expect(byId.get('evt-next')!.agenda).toEqual([]);
    expect(items.rows).toEqual([]);
    expect(undone).toEqual([
      {
        payload: { title: 'Plan 2 to 3 backup activities' },
        quote:
          'Plan 2 to 3 backup activities for each rush event in case it slows down.',
      },
    ]);
  });

  it('is refused with Events off', async () => {
    const { service } = setup({ events: [last, event('evt-next')] });
    await expect(
      service.send(CHAPTER, OFFICER, 'sugg-1', { events: false }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
