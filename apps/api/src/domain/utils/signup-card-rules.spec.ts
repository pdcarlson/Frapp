import {
  SIGNUP_SLOT_CAPACITY_MAX,
  SIGNUP_SLOTS_MAX,
  SIGNUP_TITLE_MAX_LENGTH,
} from '@repo/validation';
import { normalizeSignupCard, signupClaimSlotIds } from './signup-card-rules';

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
