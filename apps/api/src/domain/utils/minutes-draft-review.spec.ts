import type { MeetingDraftOutput } from '@repo/validation';
import {
  applyReview,
  buildReviewPrompt,
  candidatesOf,
  isProceduralDecision,
  type ReviewedMinutes,
} from './minutes-draft-review';
import type { MinutesDraftRequest } from './minutes-draft';

const empty: MeetingDraftOutput = {
  tldr: '',
  tabled: [],
  summary: '',
  announcements: '',
  decisions: [],
  action_items: [],
  officer_reports: '',
  old_business: '',
  new_business: '',
  discussion_log: '',
  open_questions: [],
  conflicts: [],
};

const request: MinutesDraftRequest = {
  meetingName: 'Formal Chapter',
  meetingType: 'chapter',
  otherLabel: null,
  meetingDate: '2026-11-15',
  sections: ['summary', 'decisions', 'action_items', 'discussion_log'],
  roster: [],
  notes: '',
};

const parts: MeetingDraftOutput[] = [
  {
    ...empty,
    summary: 'Elections.',
    decisions: [
      {
        text: 'The chapter voted to move on to new business.',
        vote: null,
        quote: 'All in favor moving on to new business? Any opposed?',
      },
    ],
  },
  {
    ...empty,
    summary: 'New business.',
    discussion_log: 'Rusty Pipes asked to host their afterparty.',
    decisions: [
      {
        text: 'The chapter voted to discuss the Rusty Pipes afterparty request.',
        vote: null,
        quote: 'Seconded. All in favor? All right, okay, cool.',
      },
      {
        text: 'The chapter approved hosting the Rusty Pipes afterparty with conditions.',
        vote: null,
        quote: 'Okay so that passes, with the deposit.',
        source: 'S1',
      },
    ],
    action_items: [
      {
        text: 'Collect the security deposit.',
        owner: null,
        due_date: null,
        quote: 'someone has to get the deposit from them',
      },
    ],
  },
];

describe('the editor’s read over a draft', () => {
  it('numbers every candidate in meeting order and never shows the notes', () => {
    expect(candidatesOf(parts).map((c) => c.id)).toEqual([
      'D1',
      'D2',
      'D3',
      'A1',
    ]);
    const prompt = buildReviewPrompt(request, parts);
    const content = String(prompt.messages[0].content);
    expect(content).toContain(
      'D3 (part 2) The chapter approved hosting the Rusty Pipes afterparty with conditions.',
    );
    expect(content).toContain(
      'words: "Okay so that passes, with the deposit."',
    );
    expect(content).toContain('Part 2 of 2:');
    expect(prompt.system).toContain('Drop every procedural step');
  });

  it('keeps an outcome with the words of the line that settled it', () => {
    const reviewed: ReviewedMinutes = {
      ...empty,
      decisions: [
        {
          from: ['D3', 'D2'],
          text: 'Approved hosting the Rusty Pipes afterparty on December 5 with a security deposit.',
          vote: null,
        },
        { from: ['D404'], text: 'Bought a boat.', vote: null },
      ],
      action_items: [
        {
          from: ['A1'],
          text: 'Collect the security deposit.',
          owner: null,
          due_date: 'next week',
        },
      ],
      open_questions: [],
    };
    const out = applyReview(parts, reviewed);
    expect(out.decisions).toEqual([
      {
        text: 'Approved hosting the Rusty Pipes afterparty on December 5 with a security deposit.',
        vote: null,
        quote: 'Okay so that passes, with the deposit.',
        source: 'S1',
      },
      // No words in the notes: verification leaves it out and counts it.
      { text: 'Bought a boat.', vote: null, quote: '' },
    ]);
    expect(out.action_items[0]).toMatchObject({
      quote: 'someone has to get the deposit from them',
      due_date: null,
    });
  });

  it('passes every part’s tabled matters through untouched (#5522)', () => {
    const tabled = [{ text: 'Formal budget', quote: 'push budget' }];
    const out = applyReview(
      [
        { ...empty, tabled },
        { ...empty, tabled: [] },
      ],
      { ...empty, decisions: [], action_items: [], open_questions: [] },
    );
    expect(out.tabled).toEqual(tabled);
  });

  it('keeps a decision’s headline and passes every part’s dates through (#5562)', () => {
    const dates = [
      { date: '2026-12-05', text: 'Afterparty', quote: 'December 5' },
    ];
    const out = applyReview([{ ...parts[0], dates }, ...parts.slice(1)], {
      ...empty,
      decisions: [
        {
          from: ['D3'],
          headline: 'Afterparty on December 5',
          text: 'Approved hosting the Rusty Pipes afterparty on December 5 with a security deposit.',
          vote: null,
        },
      ],
      action_items: [],
      open_questions: [],
    });
    expect(out.decisions[0]).toMatchObject({
      headline: 'Afterparty on December 5',
    });
    expect(out.dates).toEqual(dates);
  });

  it('takes the words of the candidate that holds the count, whichever is named first', () => {
    const counted: MeetingDraftOutput[] = [
      {
        ...empty,
        decisions: [
          {
            text: 'Motion to approve the afterparty.',
            vote: null,
            quote: 'I move we approve the afterparty',
          },
          {
            text: 'Approved the afterparty.',
            vote: { for: 30, against: 2, abstain: 1 },
            quote: 'Thirty for, two against, one abstain, it passes',
          },
        ],
      },
    ];
    const out = applyReview(counted, {
      ...empty,
      decisions: [
        {
          from: ['D1', 'D2'],
          text: 'Approved the afterparty.',
          vote: { for: 30, against: 2, abstain: 1 },
        },
      ],
      action_items: [],
      open_questions: [],
    });
    expect(out.decisions[0].quote).toBe(
      'Thirty for, two against, one abstain, it passes',
    );
  });

  it('reads an id written loosely, and leaves an item naming none without words', () => {
    const out = applyReview(parts, {
      ...empty,
      decisions: [
        { from: ['d1.'], text: 'Kept.', vote: null },
        { from: ['D99'], text: 'Made up.', vote: null },
      ],
      action_items: [],
      open_questions: [],
    });
    expect(out.decisions[0].quote).not.toBe('');
    expect(out.decisions[1].quote).toBe('');
  });

  it('takes out a procedural step the review let through', () => {
    const reviewed: ReviewedMinutes = {
      ...empty,
      decisions: [
        {
          from: ['D1'],
          text: 'The chapter voted to move on to new business.',
          vote: null,
        },
      ],
      action_items: [],
      open_questions: [],
    };
    expect(applyReview(parts, reviewed).decisions).toEqual([]);
  });

  it.each([
    'The chapter voted to move on to special business instead of holding a pit review.',
    'The chapter voted to move on to announcements.',
    'The chapter voted to discuss the Rusty Pipes afterparty request.',
    'Voted to adjourn.',
    'The chapter voted to open the floor for nominations.',
    'The chapter voted to move on to new business.',
    'The chapter voted to go to the next item.',
  ])('reads "%s" as procedure', (text) => {
    expect(isProceduralDecision(text)).toBe(true);
  });

  it.each([
    'The chapter agreed to have about 30 rush shirts as a rough number.',
    'Paul Carlson was re-elected president by a vote of 9 to 5.',
    'The chapter voted to table the spring break trip until January.',
    'The chapter voted to move the formal to February 7.',
    'The chapter voted to move into the new house on Elm Street.',
    'The chapter voted to go to the regional conference.',
    'The chapter decided to proceed with the venue deposit.',
    'The chapter voted to start a scholarship fund.',
    'The chapter agreed to skip the spring formal.',
    'The chapter approved a motion to begin renovations.',
  ])('keeps "%s"', (text) => {
    expect(isProceduralDecision(text)).toBe(false);
  });
});
