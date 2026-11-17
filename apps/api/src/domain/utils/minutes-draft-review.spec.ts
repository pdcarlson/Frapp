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
    ]);
    expect(out.action_items[0]).toMatchObject({
      quote: 'someone has to get the deposit from them',
      due_date: null,
    });
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
  ])('reads "%s" as procedure', (text) => {
    expect(isProceduralDecision(text)).toBe(true);
  });

  it.each([
    'The chapter agreed to have about 30 rush shirts as a rough number.',
    'Paul Carlson was re-elected president by a vote of 9 to 5.',
    'The chapter voted to table the spring break trip until January.',
    'The chapter voted to move the formal to February 7.',
  ])('keeps "%s"', (text) => {
    expect(isProceduralDecision(text)).toBe(false);
  });
});
