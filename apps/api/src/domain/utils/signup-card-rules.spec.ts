import {
  SIGNUP_SLOT_CAPACITY_MAX,
  SIGNUP_SLOTS_MAX,
  SIGNUP_TITLE_MAX_LENGTH,
} from '@repo/validation';
import {
  isSignupCardClosed,
  normalizeSignupCard,
  signupClaimNote,
  signupClaimSlotIds,
} from './signup-card-rules';

describe('normalizeSignupCard (#3926)', () => {
  const slot = (id: string, capacity: unknown = 2) => ({
    id,
    label: `Slot ${id}`,
    capacity,
  });

  it('keeps the card a client composes, trimmed, and nothing else', () => {
    expect(
      normalizeSignupCard({
        title: '  Sober drivers  ',
        note: '  10pm to 2am ',
        slots: [
          slot('fri'),
          { id: 'sat', label: ' Saturday ', capacity: null },
        ],
        closed_at: '2026-01-01T00:00:00Z',
        closed_by: 'someone-else',
        extra: true,
      }),
    ).toEqual({
      card: {
        title: 'Sober drivers',
        note: '10pm to 2am',
        slots: [
          { id: 'fri', label: 'Slot fri', capacity: 2 },
          { id: 'sat', label: 'Saturday', capacity: null },
        ],
      },
    });
  });

  it('drops a blank note and reads a missing capacity as no limit', () => {
    expect(
      normalizeSignupCard({
        title: 'Car wash',
        note: '   ',
        slots: [{ id: 'a', label: 'Buckets' }],
      }),
    ).toEqual({
      card: {
        title: 'Car wash',
        slots: [{ id: 'a', label: 'Buckets', capacity: null }],
      },
    });
  });

  it.each([
    ['no payload', null],
    ['no title', { title: ' ', slots: [slot('a')] }],
    [
      'a long title',
      { title: 'x'.repeat(SIGNUP_TITLE_MAX_LENGTH + 1), slots: [slot('a')] },
    ],
    ['no slots', { title: 'T', slots: [] }],
    [
      'too many slots',
      {
        title: 'T',
        slots: Array.from({ length: SIGNUP_SLOTS_MAX + 1 }, (_, i) =>
          slot(`s${i}`),
        ),
      },
    ],
    ['a slot without a name', { title: 'T', slots: [{ id: 'a', label: '' }] }],
    ['a repeated slot id', { title: 'T', slots: [slot('a'), slot('a')] }],
    ['a zero limit', { title: 'T', slots: [slot('a', 0)] }],
    ['a fractional limit', { title: 'T', slots: [slot('a', 1.5)] }],
    ['a limit as text', { title: 'T', slots: [slot('a', '2')] }],
    [
      'a limit over the most',
      { title: 'T', slots: [slot('a', SIGNUP_SLOT_CAPACITY_MAX + 1)] },
    ],
    ['a note that is not text', { title: 'T', note: 3, slots: [slot('a')] }],
  ])('refuses %s', (_name, payload) => {
    expect(normalizeSignupCard(payload)).toHaveProperty('error');
  });
});

describe('signupClaimSlotIds (#3926)', () => {
  it('reads the slot list, dropping repeats', () => {
    expect(signupClaimSlotIds({ slot_ids: ['a', 'b', 'a'] })).toEqual([
      'a',
      'b',
    ]);
  });

  it('reads an empty list as dropping out of every slot', () => {
    expect(signupClaimSlotIds({ slot_ids: [] })).toEqual([]);
  });

  it.each([
    ['no list', {}],
    ['one id rather than a list', { slot_ids: 'a' }],
    ['a list with a number', { slot_ids: ['a', 1] }],
    [
      'more ids than a card can have',
      {
        slot_ids: Array.from(
          { length: SIGNUP_SLOTS_MAX + 1 },
          (_, i) => `${i}`,
        ),
      },
    ],
  ])('refuses %s', (_name, payload) => {
    expect(signupClaimSlotIds(payload)).toBeNull();
  });
});

describe('headcount and end time (#3926 step 2)', () => {
  const NOW = Date.parse('2026-11-12T12:00:00.000Z');

  it('builds a headcount’s two slots itself, whatever the client sent', () => {
    expect(
      normalizeSignupCard(
        {
          title: ' Formal ',
          format: 'headcount',
          slots: [{ id: 'x', label: 'Free beer', capacity: 1 }],
          closed_at: '2026-01-01T00:00:00Z',
        },
        NOW,
      ),
    ).toEqual({
      card: {
        title: 'Formal',
        format: 'headcount',
        slots: [
          { id: 'going', label: 'Going', capacity: null },
          { id: 'not_going', label: 'Can’t make it', capacity: null },
        ],
      },
    });
  });

  it('refuses a format it does not know', () => {
    expect(
      normalizeSignupCard({ title: 'T', format: 'rsvp', slots: [] }, NOW),
    ).toEqual({ error: 'Unknown sign-up card format' });
  });

  it('keeps an end time as ISO, a past one included, and refuses a bad one', () => {
    const base = { title: 'T', slots: [{ id: 'a', label: 'A', capacity: 1 }] };
    const at = (closes_at: unknown) =>
      normalizeSignupCard({ ...base, closes_at }, NOW);

    expect(at('2026-11-13T09:00:00+02:00')).toMatchObject({
      card: { closes_at: '2026-11-13T07:00:00.000Z' },
    });
    // Queued offline past its end: posts closed rather than failing.
    expect(at('2026-11-01T00:00:00Z')).toMatchObject({
      card: { closes_at: '2026-11-01T00:00:00.000Z' },
    });
    expect(at('')).toEqual({
      card: expect.not.objectContaining({ closes_at: expect.anything() }),
    });
    expect(at('soon')).toEqual({
      error: 'A sign-up card’s end time must be a date and time',
    });
    expect(at('2028-01-01T00:00:00Z')).toEqual({
      error: 'A sign-up card can end at most a year from now',
    });
  });

  it('reads a card closed early or past its end time as closed', () => {
    expect(isSignupCardClosed({ closed_at: '2026-11-12T00:00:00Z' }, NOW)).toBe(
      true,
    );
    expect(isSignupCardClosed({ closes_at: '2026-11-12T11:59:59Z' }, NOW)).toBe(
      true,
    );
    expect(isSignupCardClosed({ closes_at: '2026-11-12T12:00:01Z' }, NOW)).toBe(
      false,
    );
    expect(isSignupCardClosed({ closes_at: 'garbage' }, NOW)).toBe(false);
    expect(isSignupCardClosed({}, NOW)).toBe(false);
  });

  it('takes a note only on a headcount answer, and only short', () => {
    expect(signupClaimNote({ note: ' late ' }, true)).toEqual({ note: 'late' });
    expect(signupClaimNote({ note: '   ' }, true)).toEqual({ note: null });
    expect(signupClaimNote({}, false)).toEqual({ note: null });
    expect(signupClaimNote({ note: 'hi' }, false)).toEqual({
      error: 'Only a headcount answer takes a note',
    });
    expect(signupClaimNote({ note: 3 }, true)).toEqual({
      error: 'A note must be text',
    });
    expect(signupClaimNote({ note: 'x'.repeat(141) }, true)).toEqual({
      error: 'A note can be at most 140 characters',
    });
  });
});
