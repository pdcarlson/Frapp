import { EMPTY_MEETING_CONTENT, type MeetingContent } from '@repo/validation';
import {
  agendaKeyText,
  agendaSuggestMessages,
  aiSuggestionKey,
  checkAgendaSuggestions,
  rolePhrases,
  tabledCandidates,
  tabledSuggestionKey,
  type AgendaSourceMinutes,
  type AgendaSuggestFacts,
} from './agenda-suggestions';

const M1 = '11111111-0000-4000-8000-000000000001';
const M2 = '11111111-0000-4000-8000-000000000002';
const M3 = '11111111-0000-4000-8000-000000000003';

function minutes(
  id: string,
  start: string,
  tabled: MeetingContent['tabled'],
): AgendaSourceMinutes {
  return {
    id,
    event_name: 'Cabinet',
    event_start_time: start,
    content: { ...EMPTY_MEETING_CONTENT, tabled },
  };
}

const first = (text: string) => ({
  text,
  first_meeting_id: null,
  first_start_time: null,
  times: 1,
});

describe('tabledCandidates', () => {
  it('offers a matter tabled at a meeting, dated by that meeting', () => {
    const found = tabledCandidates(
      [minutes(M1, '2026-11-11T23:00:00.000Z', [first('Formal budget')])],
      [],
    );
    expect(found).toEqual([
      {
        text: 'Formal budget',
        tabledFrom: {
          meeting_id: M1,
          start_time: '2026-11-11T23:00:00.000Z',
          times: 1,
        },
        sourceMeetingId: M1,
        key: tabledSuggestionKey(
          {
            meeting_id: M1,
            start_time: '2026-11-11T23:00:00.000Z',
            times: 1,
          },
          'Formal budget',
        ),
      },
    ]);
  });

  it('keeps a matter tabled again at its first date, at its newest count, once', () => {
    // Newest first, as the service reads them: M2 tabled it again.
    const found = tabledCandidates(
      [
        minutes(M2, '2026-11-18T23:00:00.000Z', [
          {
            text: 'Formal budget',
            first_meeting_id: M1,
            first_start_time: '2026-11-11T23:00:00.000Z',
            times: 2,
          },
        ]),
        minutes(M1, '2026-11-11T23:00:00.000Z', [first('Formal budget')]),
      ],
      [],
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual(
      expect.objectContaining({
        tabledFrom: {
          meeting_id: M1,
          start_time: '2026-11-11T23:00:00.000Z',
          times: 2,
        },
        sourceMeetingId: M2,
      }),
    );
  });

  it('leaves out a matter an agenda already took up, and one on tonight’s agenda', () => {
    const source = [
      minutes(M3, '2026-11-18T23:00:00.000Z', [
        first('Formal budget'),
        first('Rush shirts'),
        first('New composite'),
        first('Bylaws'),
      ]),
    ];
    const taken = tabledCandidates(source, [])[0].key;
    const found = tabledCandidates(
      source,
      [
        { id: 'a1', text: 'rush shirts.', done: false },
        {
          id: 'a2',
          text: 'New composite',
          done: false,
          tabled_from: {
            meeting_id: M3,
            start_time: '2026-11-18T23:00:00.000Z',
            times: 1,
          },
        },
      ],
      new Set([taken]),
    );
    // Another matter from the same minutes still shows.
    expect(found.map((candidate) => candidate.text)).toEqual(['Bylaws']);
  });

  it('cuts to the most it offers only after leaving matters out', () => {
    const source = [
      minutes(
        M3,
        '2026-11-18T23:00:00.000Z',
        Array.from({ length: 12 }, (_, i) => first(`Matter ${i + 1}`)),
      ),
    ];
    const all = tabledCandidates(source, [], new Set(), Infinity);
    const found = tabledCandidates(
      source,
      [],
      new Set(all.slice(0, 3).map((candidate) => candidate.key)),
    );
    expect(found).toHaveLength(9);
    expect(found.at(-1)?.text).toBe('Matter 12');
  });

  it('gives a matter tabled again a new key, so a later meeting can offer it again', () => {
    const from = {
      meeting_id: M1,
      start_time: '2026-11-11T23:00:00.000Z',
      times: 1,
    };
    expect(tabledSuggestionKey(from, 'Formal budget')).not.toBe(
      tabledSuggestionKey({ ...from, times: 2 }, 'Formal budget'),
    );
    expect(tabledSuggestionKey(from, 'Formal  Budget.')).toBe(
      tabledSuggestionKey(from, 'formal budget'),
    );
  });
});

const facts = (
  overrides: Partial<AgendaSuggestFacts> = {},
): AgendaSuggestFacts => ({
  event: {
    name: 'Cabinet',
    type: 'Exec meeting',
    day: 'Tuesday, 2026-11-25',
    description: null,
  },
  audience: {
    required: [
      {
        name: 'Treasurer',
        tier: 'Executive',
        members: 1,
        does: ['run the chapter’s money'],
      },
    ],
    invited: [],
    leftOut: [],
    everyoneElse: false,
  },
  agenda: ['Treasurer report'],
  tabled: ['Formal budget'],
  minutes: [
    {
      ref: 'M1',
      meetingId: M1,
      name: 'Cabinet',
      day: 'Tuesday, 2026-11-18',
      gist: '- Dues are due Friday',
      topics: ['Philanthropy'],
      openItems: ['Book the venue'],
      reports: ['Treasurer'],
    },
  ],
  examples: { added: ['Risk report'], dismissed: ['Pizza order'] },
  ...overrides,
});

describe('checkAgendaSuggestions', () => {
  it('keeps short new items, naming the minutes they came from', () => {
    const checked = checkAgendaSuggestions(
      {
        items: [
          { text: '  Venue  check-in ', reason: 'Still open', minutes: 'M1' },
          { text: 'Dues reminder', reason: '', minutes: 'M9' },
        ],
      },
      facts(),
      new Set(),
    );
    expect(checked).toEqual([
      {
        text: 'Venue check-in',
        reason: 'Still open',
        sourceMeetingId: M1,
        key: aiSuggestionKey('Venue check-in'),
      },
      {
        text: 'Dues reminder',
        reason: null,
        sourceMeetingId: null,
        key: aiSuggestionKey('Dues reminder'),
      },
    ]);
  });

  it('drops what the agenda, the tabled list, a dismissal or this event already has', () => {
    const checked = checkAgendaSuggestions(
      {
        items: [
          { text: 'treasurer report.', reason: 'x' },
          { text: 'Formal Budget', reason: 'x' },
          { text: 'Pizza order', reason: 'x' },
          { text: 'Philanthropy', reason: 'x' },
          { text: 'Philanthropy!', reason: 'x' },
          { text: 'x'.repeat(201), reason: 'x' },
          { text: '   ', reason: 'x' },
        ],
      },
      facts(),
      new Set([aiSuggestionKey('Philanthropy')]),
    );
    expect(checked).toEqual([]);
  });

  it('keeps at most five', () => {
    const checked = checkAgendaSuggestions(
      {
        items: Array.from({ length: 8 }, (_, i) => ({
          text: `Item ${i}`,
          reason: 'x',
        })),
      },
      facts(),
      new Set(),
    );
    expect(checked).toHaveLength(5);
  });
});

describe('agendaSuggestMessages', () => {
  it('tells the model the audience, the roles, the minutes and the examples', () => {
    const [message] = agendaSuggestMessages(facts());
    expect(message.content).toContain('Meeting: Cabinet (Exec meeting)');
    expect(message.content).toContain(
      '- Treasurer; tier Executive; 1 member; can run the chapter’s money',
    );
    expect(message.content).toContain('Nobody else is invited.');
    expect(message.content).toContain('M1: Cabinet, Tuesday, 2026-11-18');
    expect(message.content).toContain('  Open action items: Book the venue');
    expect(message.content).toContain('- Risk report');
    expect(message.content).toContain('- Pizza order');
  });
});

describe('rolePhrases and agendaKeyText', () => {
  it('says what a role can do in plain words', () => {
    expect(rolePhrases(['meetings:record', 'events:create'])).toEqual([
      'plan events',
      'take minutes',
    ]);
    expect(rolePhrases(['*'])).toEqual(['do everything in Frapp']);
  });

  it('tells items apart by words, not case, spacing or end punctuation', () => {
    expect(agendaKeyText(' Formal   Budget. ')).toBe('formal budget');
  });
});
