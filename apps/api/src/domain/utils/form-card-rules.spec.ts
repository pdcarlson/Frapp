import {
  formQuestions,
  normalizeFormAnswers,
  normalizeFormCard,
  type FormQuestion,
} from './form-card-rules';
import { normalizeClosesAt } from './card-closing';
import {
  FORM_QUESTIONS_MAX,
  FORM_SHORT_ANSWER_MAX_LENGTH,
} from '@repo/validation';

const NOW = Date.parse('2026-11-13T12:00:00Z');

const choice = (type: string, extra: Record<string, unknown> = {}) => ({
  id: 'q',
  type,
  title: 'Room?',
  options: [
    { id: 'a', label: 'Room A' },
    { id: 'b', label: 'Room B' },
  ],
  ...extra,
});

describe('normalizeFormCard (#3926 step 3)', () => {
  it('rebuilds the card from its known fields, trimmed', () => {
    expect(
      normalizeFormCard(
        {
          title: ' Room picks ',
          description: '  ',
          questions: [
            { id: 'q1', type: 'short_answer', title: ' Name ', required: true },
            { id: 'q2', type: 'yes_no', title: 'Staying?', options: [{}] },
            choice('dropdown'),
          ],
          closed_at: '2026-01-01T00:00:00Z',
          closed_by: 'x',
          extra: 1,
        },
        NOW,
      ),
    ).toEqual({
      card: {
        title: 'Room picks',
        questions: [
          { id: 'q1', type: 'short_answer', title: 'Name', required: true },
          { id: 'q2', type: 'yes_no', title: 'Staying?', required: false },
          {
            id: 'q',
            type: 'dropdown',
            title: 'Room?',
            required: false,
            options: [
              { id: 'a', label: 'Room A' },
              { id: 'b', label: 'Room B' },
            ],
          },
        ],
      },
    });
  });

  it('keeps a description and an end time', () => {
    const result = normalizeFormCard(
      {
        title: 'T',
        description: ' Pick by Friday ',
        questions: [{ id: 'q', type: 'paragraph', title: 'Why?' }],
        closes_at: '2026-11-20T18:00:00Z',
      },
      NOW,
    );
    expect(result).toMatchObject({
      card: {
        description: 'Pick by Friday',
        closes_at: '2026-11-20T18:00:00.000Z',
      },
    });
  });

  it.each([
    ['no payload', null, 'A form needs a title and at least one question'],
    ['no title', { questions: [] }, 'A form needs a title'],
    [
      'no questions',
      { title: 'T', questions: [] },
      'A form needs at least one question',
    ],
    [
      'too many questions',
      {
        title: 'T',
        questions: Array.from({ length: FORM_QUESTIONS_MAX + 1 }, (_, i) => ({
          id: `q${i}`,
          type: 'short_answer',
          title: 'Q',
        })),
      },
      `A form can have at most ${FORM_QUESTIONS_MAX} questions`,
    ],
    [
      'an unknown type',
      { title: 'T', questions: [{ id: 'q', type: 'slider', title: 'Q' }] },
      'Unknown question type',
    ],
    [
      'a question with no title',
      { title: 'T', questions: [{ id: 'q', type: 'paragraph', title: ' ' }] },
      'Each question needs an id, a type and a question',
    ],
    [
      'a question id an object inherits',
      {
        title: 'T',
        questions: [{ id: 'constructor', type: 'short_answer', title: 'Q' }],
      },
      'Each question needs an id, a type and a question',
    ],
    [
      'the question id __proto__',
      {
        title: 'T',
        questions: [{ id: '__proto__', type: 'short_answer', title: 'Q' }],
      },
      'Each question needs an id, a type and a question',
    ],
    [
      'a repeated question id',
      {
        title: 'T',
        questions: [
          { id: 'q', type: 'paragraph', title: 'A' },
          { id: 'q', type: 'paragraph', title: 'B' },
        ],
      },
      'Each question needs its own id',
    ],
    [
      'a choice question with no options',
      { title: 'T', questions: [choice('checkboxes', { options: [] })] },
      'A choice question needs at least one option',
    ],
    [
      'a repeated option id',
      {
        title: 'T',
        questions: [
          choice('multiple_choice', {
            options: [
              { id: 'a', label: 'A' },
              { id: 'a', label: 'B' },
            ],
          }),
        ],
      },
      'Each option needs its own id',
    ],
    [
      'a non-boolean required',
      {
        title: 'T',
        questions: [
          { id: 'q', type: 'paragraph', title: 'A', required: 'yes' },
        ],
      },
      'A question’s required setting must be true or false',
    ],
    [
      'an end time over a year out',
      {
        title: 'T',
        questions: [{ id: 'q', type: 'paragraph', title: 'A' }],
        closes_at: '2028-01-01T00:00:00Z',
      },
      'A form can end at most a year from now',
    ],
  ])('refuses %s', (_, payload, error) => {
    expect(normalizeFormCard(payload, NOW)).toEqual({ error });
  });
});

describe('normalizeFormAnswers (#3926 step 3)', () => {
  const questions = formQuestions({
    questions: [
      { id: 'name', type: 'short_answer', title: 'Name', required: true },
      { id: 'why', type: 'paragraph', title: 'Why?' },
      choice('multiple_choice', { id: 'room' }),
      choice('checkboxes', { id: 'nights' }),
      choice('dropdown', { id: 'floor' }),
      { id: 'stay', type: 'yes_no', title: 'Staying?' },
    ],
  });

  it('reads only the answers object’s own keys', () => {
    // A card stored before ids were checked: `toString` is inherited by
    // every object, and a blank answer to it must still read as blank.
    const inherited = [
      {
        id: 'toString',
        type: 'short_answer' as const,
        title: 'Q',
        required: false,
      },
    ];
    expect(normalizeFormAnswers(inherited, {})).toEqual({ answers: {} });
  });

  it('stores each answer as its question takes it, dropping blanks', () => {
    expect(
      normalizeFormAnswers(questions, {
        name: ' Sam ',
        why: '',
        room: 'b',
        nights: ['b', 'a', 'b'],
        floor: '',
        stay: 'yes',
      }),
    ).toEqual({
      answers: { name: 'Sam', room: 'b', nights: ['a', 'b'], stay: 'yes' },
    });
  });

  it.each([
    [
      'a blank required question',
      { why: 'x' },
      'Answer every required question',
    ],
    [
      'an unknown question',
      { name: 'Sam', other: 'x' },
      'An answer names a question the form doesn’t ask',
    ],
    [
      'an unknown option',
      { name: 'Sam', room: 'c' },
      'Pick one of the question’s options',
    ],
    [
      'a list on a pick-one question',
      { name: 'Sam', room: ['a'] },
      'Pick one of the question’s options',
    ],
    [
      'an unknown checkbox',
      { name: 'Sam', nights: ['z'] },
      'Pick from the question’s options',
    ],
    [
      'a yes/no other than yes or no',
      { name: 'Sam', stay: 'maybe' },
      'Answer yes or no',
    ],
    ['text that is not text', { name: 5 }, 'An answer must be text'],
    [
      'a short answer too long',
      { name: 'x'.repeat(FORM_SHORT_ANSWER_MAX_LENGTH + 1) },
      `An answer can be at most ${FORM_SHORT_ANSWER_MAX_LENGTH} characters`,
    ],
    [
      'answers that are not keyed',
      ['Sam'],
      'Answers must be keyed by question',
    ],
  ])('refuses %s', (_, raw, error) => {
    expect(normalizeFormAnswers(questions, raw)).toEqual({ error });
  });

  it('reads no questions from a payload it cannot read', () => {
    expect(formQuestions(null)).toEqual([]);
    expect(formQuestions({ questions: [{ id: 'q' }] })).toEqual([]);
  });
});

describe('card closing (#3926)', () => {
  it('names the card in its refusals', () => {
    expect(normalizeClosesAt('soon', 'A form', NOW)).toEqual({
      error: 'A form’s end time must be a date and time',
    });
    expect(normalizeClosesAt('', 'A form', NOW)).toEqual({});
  });
});
