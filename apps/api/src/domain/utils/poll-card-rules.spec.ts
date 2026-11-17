import { normalizePollCard } from './poll-card-rules';

const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const card = (overrides: Record<string, unknown> = {}) => ({
  question: 'Formal venue?',
  options: [
    { id: 'a1b2c3d4', label: 'The Lodge' },
    { id: 'e5f6g7h8', label: 'Riverside' },
  ],
  closes_at: '2026-11-18T12:00:00.000Z',
  ...overrides,
});

describe('normalizePollCard', () => {
  it('keeps a card as `buildPollMessage` builds it', () => {
    expect(normalizePollCard(card(), NOW)).toEqual({ card: card() });
  });

  it('keeps a multi-choice card, and stores a single-choice one without the mode', () => {
    expect(
      normalizePollCard(card({ choice_mode: 'multi' }), NOW),
    ).toMatchObject({ card: { choice_mode: 'multi' } });
    const single = normalizePollCard(card({ choice_mode: 'single' }), NOW);
    expect('card' in single && 'choice_mode' in single.card).toBe(false);
  });

  it('stores a poll with no deadline as `closes_at: null`', () => {
    expect(normalizePollCard(card({ closes_at: null }), NOW)).toMatchObject({
      card: { closes_at: null },
    });
    expect(
      normalizePollCard(card({ closes_at: undefined }), NOW),
    ).toMatchObject({ card: { closes_at: null } });
  });

  it('drops the early close and every key the card does not define', () => {
    const result = normalizePollCard(
      card({
        closed_at: '2026-11-17T00:00:00.000Z',
        closed_by: 'someone',
        tally: { a1b2c3d4: 40 },
        options: [
          { id: 'a1b2c3d4', label: 'The Lodge', votes: 99 },
          { id: 'e5f6g7h8', label: 'Riverside' },
        ],
      }),
      NOW,
    );
    expect(result).toEqual({ card: card() });
  });

  it('trims the question and labels', () => {
    expect(
      normalizePollCard(
        card({
          question: '  Formal venue?  ',
          options: [
            { id: 'a1b2c3d4', label: ' The Lodge ' },
            { id: 'e5f6g7h8', label: 'Riverside' },
          ],
        }),
        NOW,
      ),
    ).toEqual({ card: card() });
  });

  it('takes ten options of the longest label the forms allow', () => {
    const options = Array.from({ length: 10 }, (_, i) => ({
      id: `opt-${i}`,
      label: 'x'.repeat(200),
    }));
    expect(
      normalizePollCard(card({ question: 'q'.repeat(500), options }), NOW),
    ).toHaveProperty('card');
  });

  it.each([
    ['not an object', 'poll'],
    ['no question', card({ question: '  ' })],
    ['a question over 500 characters', card({ question: 'q'.repeat(501) })],
    ['options that are not a list', card({ options: 'a,b' })],
    ['one option', card({ options: [{ id: 'a', label: 'Only' }] })],
    [
      'eleven options',
      card({
        options: Array.from({ length: 11 }, (_, i) => ({
          id: `o${i}`,
          label: 'x',
        })),
      }),
    ],
    [
      'an option with no id',
      card({
        options: [{ label: 'Yes' }, { id: 'b', label: 'No' }],
      }),
    ],
    [
      'an option with a blank label',
      card({
        options: [
          { id: 'a', label: ' ' },
          { id: 'b', label: 'No' },
        ],
      }),
    ],
    [
      'two options with one id',
      card({
        options: [
          { id: 'a', label: 'Yes' },
          { id: 'a', label: 'No' },
        ],
      }),
    ],
    [
      'a label over 200 characters',
      card({
        options: [
          { id: 'a', label: 'x'.repeat(201) },
          { id: 'b', label: 'No' },
        ],
      }),
    ],
    [
      'an option id over 64 characters',
      card({
        options: [
          { id: 'i'.repeat(65), label: 'Yes' },
          { id: 'b', label: 'No' },
        ],
      }),
    ],
    ['an unknown choice mode', card({ choice_mode: 'ranked' })],
    ['a deadline that is not a date', card({ closes_at: 'soon' })],
    [
      'a deadline more than a year out',
      card({ closes_at: '2028-01-01T00:00:00.000Z' }),
    ],
  ])('refuses %s', (_label, payload) => {
    expect(normalizePollCard(payload, NOW)).toHaveProperty('error');
  });
});
