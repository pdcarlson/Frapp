import { NotFoundException } from '@nestjs/common';
import type { EventAgendaItem } from '@repo/validation';
import type { Event } from '#domain/entities/event.entity';
import type {
  EventAgendaSuggestion,
  EventAgendaSuggestionRun,
} from '#domain/entities/event-agenda-suggestion.entity';
import type { Meeting } from '#domain/entities/meeting.entity';
import type {
  EventAgendaSuggestionDraft,
  IEventAgendaSuggestionRepository,
} from '#domain/repositories/event-agenda-suggestion.repository.interface';
import {
  AgendaSuggestionService,
  agendaItemIdOf,
} from './agenda-suggestion.service';
import type { AiConsentService } from './ai/ai-consent.service';
import type { AiGatewayService } from './ai/ai-gateway.service';
import type { EventService } from './event.service';
import type { MeetingService } from './meeting.service';
import type { RbacService } from './rbac.service';

const CHAPTER = 'ch-1';
const OFFICER = 'u-officer';
const EXEC_ROLE = 'role-exec';
const NOW = new Date('2026-11-20T12:00:00.000Z');
/** A first tabling's minutes: the shared schema reads only a uuid there. */
const M_A = '0a000000-0000-4000-8000-0000000005a1';

const event = (id: string, overrides: Partial<Event> = {}): Event =>
  ({
    id,
    chapter_id: CHAPTER,
    name: 'Chapter meeting',
    description: null,
    start_time: '2026-11-25T00:00:00.000Z',
    end_time: '2026-11-25T02:00:00.000Z',
    parent_event_id: null,
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
    others_invited: null,
    event_type_id: null,
    agenda: [],
    ...overrides,
  }) as Event;

const minutes = (
  id: string,
  eventId: string,
  date: string,
  tabled: { text: string; first?: [string, string]; times?: number }[],
): Meeting =>
  ({
    id,
    chapter_id: CHAPTER,
    event_id: eventId,
    event_name: 'Earlier meeting',
    event_start_time: `${date}T00:00:00.000Z`,
    meeting_type: 'chapter',
    other_label: null,
    status: 'posted',
    content: {
      tabled: tabled.map((item) => ({
        text: item.text,
        first_meeting_id: item.first?.[0] ?? null,
        first_start_time: item.first?.[1] ?? null,
        times: item.times ?? 1,
      })),
      discussion_log: 'Philanthropy\n- The 5K date',
      action_items: [
        { text: 'Book the venue', owner_user_id: null, due_date: null },
      ],
    },
  }) as unknown as Meeting;

/** An in-memory `event_agenda_suggestions`, with the table's unique key. */
class FakeRepo implements IEventAgendaSuggestionRepository {
  rows: EventAgendaSuggestion[] = [];
  runs: EventAgendaSuggestionRun[] = [];
  private next = 0;

  listForEvent(chapterId: string, eventId: string) {
    return Promise.resolve(
      this.rows.filter(
        (row) => row.chapter_id === chapterId && row.event_id === eventId,
      ),
    );
  }
  insertMany(drafts: readonly EventAgendaSuggestionDraft[]) {
    for (const draft of drafts) {
      if (
        this.rows.some(
          (row) =>
            row.event_id === draft.event_id &&
            row.dedupe_key === draft.dedupe_key,
        )
      ) {
        continue;
      }
      this.next += 1;
      this.rows.push({
        ...draft,
        id: `00000000-0000-4000-8000-${String(this.next).padStart(12, '0')}`,
        status: 'open',
        agenda_item_id: null,
        decided_by: null,
        decided_at: null,
        created_at: NOW.toISOString(),
      });
    }
    return Promise.resolve();
  }
  deleteOpen(chapterId: string, eventId: string, ids: readonly string[]) {
    this.rows = this.rows.filter(
      (row) =>
        !(
          row.chapter_id === chapterId &&
          row.event_id === eventId &&
          row.status === 'open' &&
          ids.includes(row.id)
        ),
    );
    return Promise.resolve();
  }
  decide(
    chapterId: string,
    eventId: string,
    id: string,
    change: Parameters<IEventAgendaSuggestionRepository['decide']>[3],
  ) {
    const row = this.rows.find(
      (entry) =>
        entry.chapter_id === chapterId &&
        entry.event_id === eventId &&
        entry.id === id &&
        entry.status === 'open',
    );
    if (row) Object.assign(row, change);
    return Promise.resolve(Boolean(row));
  }
  addedKeys(chapterId: string, keys: readonly string[]) {
    return Promise.resolve(
      new Set(
        this.rows
          .filter(
            (row) =>
              row.chapter_id === chapterId &&
              row.status === 'added' &&
              keys.includes(row.dedupe_key),
          )
          .map((row) => row.dedupe_key),
      ),
    );
  }
  listDecided(chapterId: string, limit: number) {
    return Promise.resolve(
      this.rows
        .filter((row) => row.chapter_id === chapterId && row.status !== 'open')
        .slice(0, limit),
    );
  }
  findRun(chapterId: string, eventId: string) {
    return Promise.resolve(
      this.runs.find(
        (run) => run.chapter_id === chapterId && run.event_id === eventId,
      ) ?? null,
    );
  }
  saveRun(run: EventAgendaSuggestionRun) {
    this.runs = [...this.runs.filter((r) => r.event_id !== run.event_id), run];
    return Promise.resolve();
  }
}

function setup(options: {
  events: Event[];
  earlier: Meeting[];
  aiAllowed?: boolean;
  modelItems?: { text: string; reason: string; minutes?: string }[];
}) {
  process.env.AI_ENABLED = 'true';
  const repo = new FakeRepo();
  const byId = new Map(options.events.map((e) => [e.id, e]));
  const events = {
    findById: jest.fn(async (id: string) => {
      const found = byId.get(id);
      if (!found) throw new NotFoundException('Event not found');
      return found;
    }),
    findVisibleByIds: jest.fn(async (ids: readonly string[]) =>
      ids.flatMap((id) => (byId.has(id) ? [byId.get(id) as Event] : [])),
    ),
    appendAgendaItem: jest.fn(
      async (id: string, _chapter: string, item: EventAgendaItem) => {
        const target = byId.get(id) as Event;
        target.agenda = [...(target.agenda ?? []), item];
        return target.agenda;
      },
    ),
  };
  const meetings = {
    listPostedBefore: jest.fn(async (_c: string, _u: string, before: string) =>
      options.earlier.filter((row) => row.event_start_time < before),
    ),
  };
  const gateway = {
    generateObject: jest.fn(async () => ({
      status: 'ok' as const,
      value: { items: options.modelItems ?? [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  };
  const consent = {
    check: jest.fn(async () =>
      options.aiAllowed === false
        ? { allowed: false, reason: 'chapter_off' }
        : { allowed: true },
    ),
  };
  const service = new AgendaSuggestionService(
    repo,
    { findChapterMemberIdentities: jest.fn(async () => []) } as never,
    { findByChapter: jest.fn(async () => []) } as never,
    { findById: jest.fn(async () => null) } as never,
    events as unknown as EventService,
    meetings as unknown as MeetingService,
    { findByChapter: jest.fn(async () => []) } as unknown as RbacService,
    gateway as unknown as AiGatewayService,
    consent as unknown as AiConsentService,
  );
  return { service, repo, events, gateway, byId };
}

afterEach(() => {
  delete process.env.AI_ENABLED;
});

describe('AgendaSuggestionService', () => {
  it('offers what earlier same-audience minutes tabled, dated by the meeting that tabled it', async () => {
    const { service } = setup({
      events: [event('evt-next'), event('evt-last')],
      earlier: [
        minutes('m-last', 'evt-last', '2026-11-18', [
          { text: 'Formal budget' },
        ]),
      ],
      aiAllowed: false,
    });
    const list = await service.list(CHAPTER, 'evt-next', OFFICER, NOW);
    expect(list.ai_available).toBe(false);
    expect(list.suggestions).toEqual([
      expect.objectContaining({
        kind: 'tabled',
        text: 'Formal budget',
        source_meeting_id: 'm-last',
        tabled_from: {
          meeting_id: 'm-last',
          start_time: '2026-11-18T00:00:00.000Z',
          times: 1,
        },
      }),
    ]);
  });

  it('never offers an exec-only meeting’s tabled item on a chapter-wide meeting', async () => {
    const { service } = setup({
      events: [
        event('evt-chapter'),
        event('evt-exec', {
          required_role_ids: [EXEC_ROLE],
          others_invited: false,
        }),
      ],
      earlier: [
        minutes('m-exec', 'evt-exec', '2026-11-18', [
          { text: 'Discipline hearing' },
        ]),
      ],
    });
    const list = await service.list(CHAPTER, 'evt-chapter', OFFICER, NOW);
    expect(list.suggestions).toEqual([]);
  });

  it('adds a tabled item to the agenda with where it came from, once', async () => {
    const { service, events, repo, byId } = setup({
      events: [event('evt-next'), event('evt-last')],
      earlier: [
        minutes('m-last', 'evt-last', '2026-11-18', [
          { text: 'Formal budget' },
        ]),
      ],
    });
    const [suggestion] = (await service.list(CHAPTER, 'evt-next', OFFICER, NOW))
      .suggestions;
    const { agenda } = await service.add(
      CHAPTER,
      'evt-next',
      suggestion.id,
      OFFICER,
      NOW,
    );
    expect(agenda).toEqual([
      {
        id: agendaItemIdOf(suggestion.id),
        text: 'Formal budget',
        done: false,
        tabled_from: {
          meeting_id: 'm-last',
          start_time: '2026-11-18T00:00:00.000Z',
          times: 1,
        },
      },
    ]);
    expect(repo.rows[0]).toEqual(
      expect.objectContaining({
        status: 'added',
        agenda_item_id: agendaItemIdOf(suggestion.id),
        decided_by: OFFICER,
      }),
    );
    // Decided: a second Add finds nothing open.
    await expect(
      service.add(CHAPTER, 'evt-next', suggestion.id, OFFICER, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(events.appendAgendaItem).toHaveBeenCalledTimes(1);
    // Taken up: the next meeting with the same audience isn't offered it.
    byId.set(
      'evt-after',
      event('evt-after', {
        start_time: '2026-12-02T00:00:00.000Z',
        end_time: '2026-12-02T02:00:00.000Z',
      }),
    );
    const later = await service.list(CHAPTER, 'evt-after', OFFICER, NOW);
    expect(later.suggestions).toEqual([]);
  });

  it('offers a matter again once a later meeting tables it again, at its first date', async () => {
    const { service, repo } = setup({
      events: [event('evt-next'), event('evt-a'), event('evt-b')],
      earlier: [
        minutes('m-b', 'evt-b', '2026-11-18', [
          {
            text: 'Formal budget',
            first: [M_A, '2026-11-11T00:00:00.000Z'],
            times: 2,
          },
        ]),
        minutes(M_A, 'evt-a', '2026-11-11', [{ text: 'Formal budget' }]),
      ],
    });
    // The first tabling was added to evt-b's agenda before.
    repo.rows.push({
      id: 'old',
      chapter_id: CHAPTER,
      event_id: 'evt-b',
      kind: 'tabled',
      text: 'Formal budget',
      reason: null,
      source_meeting_id: M_A,
      tabled_meeting_id: M_A,
      tabled_start_time: '2026-11-11T00:00:00.000Z',
      tabled_times: 1,
      dedupe_key: `tabled:${M_A}:1:formal budget`,
      status: 'added',
      agenda_item_id: 's-old',
      decided_by: OFFICER,
      decided_at: '2026-11-12T00:00:00.000Z',
      created_at: '2026-11-12T00:00:00.000Z',
    });
    const list = await service.list(CHAPTER, 'evt-next', OFFICER, NOW);
    expect(list.suggestions).toEqual([
      expect.objectContaining({
        text: 'Formal budget',
        source_meeting_id: 'm-b',
        tabled_from: {
          meeting_id: M_A,
          start_time: '2026-11-11T00:00:00.000Z',
          times: 2,
        },
      }),
    ]);
  });

  it('dismisses a suggestion for this event only, and keeps its words', async () => {
    const { service, repo } = setup({
      events: [event('evt-next'), event('evt-last')],
      earlier: [
        minutes('m-last', 'evt-last', '2026-11-18', [
          { text: 'Formal budget' },
        ]),
      ],
    });
    const [suggestion] = (await service.list(CHAPTER, 'evt-next', OFFICER, NOW))
      .suggestions;
    await service.dismiss(CHAPTER, 'evt-next', suggestion.id, OFFICER, NOW);
    expect(repo.rows[0]).toEqual(
      expect.objectContaining({ status: 'dismissed', text: 'Formal budget' }),
    );
    // Listing again doesn't bring it back.
    expect(
      (await service.list(CHAPTER, 'evt-next', OFFICER, NOW)).suggestions,
    ).toEqual([]);
  });

  it('writes the model’s items after the tabled ones, with past choices as examples', async () => {
    const { service, repo, gateway } = setup({
      events: [event('evt-next'), event('evt-last')],
      earlier: [
        minutes('m-last', 'evt-last', '2026-11-18', [
          { text: 'Formal budget' },
        ]),
      ],
      modelItems: [
        { text: 'Venue check-in', reason: 'Still open', minutes: 'M1' },
        { text: 'Formal budget', reason: 'Tabled' },
      ],
    });
    repo.rows.push({
      id: 'was-dismissed',
      chapter_id: CHAPTER,
      event_id: 'evt-last',
      kind: 'ai',
      text: 'Pizza order',
      reason: null,
      source_meeting_id: null,
      tabled_meeting_id: null,
      tabled_start_time: null,
      tabled_times: null,
      dedupe_key: 'ai:pizza order',
      status: 'dismissed',
      agenda_item_id: null,
      decided_by: OFFICER,
      decided_at: '2026-11-17T00:00:00.000Z',
      created_at: '2026-11-17T00:00:00.000Z',
    });
    const list = await service.refresh(CHAPTER, 'evt-next', OFFICER, NOW);
    expect(list.suggestions.map((s) => [s.kind, s.text])).toEqual([
      ['tabled', 'Formal budget'],
      ['ai', 'Venue check-in'],
    ]);
    expect(list.suggestions[1]).toEqual(
      expect.objectContaining({
        reason: 'Still open',
        source_meeting_id: 'm-last',
      }),
    );
    expect(list.generated_at).toBe(NOW.toISOString());
    const [, prompt] = gateway.generateObject.mock.calls[0] as unknown as [
      string,
      { messages: { content: string }[] },
    ];
    expect(prompt.messages[0].content).toContain('- Pizza order');
    expect(prompt.messages[0].content).toContain(
      'Open action items: Book the venue',
    );
  });

  it('asks the model nothing without AI, and lists the tabled ones anyway', async () => {
    const { service, gateway } = setup({
      events: [event('evt-next'), event('evt-last')],
      earlier: [
        minutes('m-last', 'evt-last', '2026-11-18', [
          { text: 'Formal budget' },
        ]),
      ],
      aiAllowed: false,
    });
    const list = await service.refresh(CHAPTER, 'evt-next', OFFICER, NOW);
    expect(gateway.generateObject).not.toHaveBeenCalled();
    expect(list.suggestions.map((s) => s.text)).toEqual(['Formal budget']);
    expect(list.generated_at).toBeNull();
  });

  it('suggests nothing for a meeting that has ended', async () => {
    const { service } = setup({
      events: [
        event('evt-past', {
          start_time: '2026-11-19T00:00:00.000Z',
          end_time: '2026-11-19T02:00:00.000Z',
        }),
        event('evt-last'),
      ],
      earlier: [
        minutes('m-last', 'evt-last', '2026-11-18', [
          { text: 'Formal budget' },
        ]),
      ],
    });
    expect(await service.list(CHAPTER, 'evt-past', OFFICER, NOW)).toEqual({
      suggestions: [],
      generated_at: null,
      ai_available: false,
    });
  });
});
