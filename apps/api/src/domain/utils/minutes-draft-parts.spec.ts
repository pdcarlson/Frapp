import { MEETING_NOTES_COPY, type MeetingDraftOutput } from '@repo/validation';
import {
  mergeParts,
  partRequests,
  splitAnswers,
  splitIntoParts,
} from './minutes-draft-parts';
import {
  recoverQuote,
  type MinutesDraftRequest,
  type MinutesSource,
} from './minutes-draft';

const request = (notes: string): MinutesDraftRequest => ({
  meetingName: 'Chapter meeting',
  meetingType: 'chapter',
  otherLabel: null,
  meetingDate: '2026-11-09',
  sections: ['summary', 'decisions', 'action_items'],
  roster: [],
  notes,
});

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

describe('drafting a long meeting in parts', () => {
  it('cuts at line breaks, never inside a line, and loses no line', () => {
    const text = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'].join('\n');
    const parts = splitIntoParts(text, 10);
    expect(parts).toEqual(['aaaa\nbbbb', 'cccc\ndddd', 'eeee']);
    expect(parts.join('\n')).toBe(text);
  });

  it('cuts a transcript that is one long line at sentence ends', () => {
    const line = Array.from(
      { length: 40 },
      (_, i) => `Point ${i} was raised.`,
    ).join(' ');
    const parts = splitIntoParts(`Formal Chapter\n\n${line}`, 200);
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(200);
      // Every part is a stretch of the notes, ending on a whole sentence.
      expect(`Formal Chapter\n\n${line}`).toContain(part);
      expect(part).toMatch(/\.$/);
    }
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(
      `Formal Chapter ${line}`.replace(/\s+/g, ' '),
    );
  });

  it('cuts between words when a stretch has no sentence end', () => {
    const parts = splitIntoParts('word '.repeat(100).trim(), 50);
    expect(
      parts.every((part) => !part.startsWith(' ') && part.length <= 50),
    ).toBe(true);
    expect(parts.every((part) => /^(word ?)+$/.test(part))).toBe(true);
  });

  it('leaves short notes, and several note-takers, to one pass', () => {
    expect(partRequests(request('short'), 100)).toBeNull();
    const source = (id: string): MinutesSource => ({
      id,
      kind: 'notes',
      label: id,
      standing: null,
      rank: 0,
      userId: null,
      text: 'line\n'.repeat(100),
    });
    expect(
      partRequests(
        { ...request(''), sources: [source('S1'), source('S2')] },
        50,
      ),
    ).toBeNull();
  });

  it('hands every part the officer’s answers', () => {
    const answers = `${MEETING_NOTES_COPY.answersHeading}\nWho books the DJ? Priya`;
    const notes = `${'one\n'.repeat(10)}${'two\n'.repeat(10)}\n${answers}`;
    expect(splitAnswers(notes).answers).toBe(answers);
    const parts = partRequests(request(notes), 45);
    expect(parts?.length).toBeGreaterThan(1);
    for (const part of parts ?? []) {
      expect(part.notes).toContain('Who books the DJ? Priya');
    }
    expect(parts?.[0].part).toEqual({ index: 1, count: parts?.length });
  });

  it('puts the parts back in order, each item once', () => {
    const decision = {
      text: 'Approved the DJ.',
      vote: null,
      quote: 'dj passed',
    };
    const merged = mergeParts([
      {
        ...empty,
        summary: 'First hour.',
        discussion_log: 'Rush.',
        decisions: [decision],
        open_questions: ['Who books it?'],
      },
      {
        ...empty,
        summary: 'Second hour.',
        discussion_log: 'Formal.',
        decisions: [
          decision,
          { text: 'Raised dues.', vote: null, quote: 'dues up' },
        ],
        open_questions: ['Who books it?'],
      },
    ]);
    expect(merged.summary).toBe('First hour. Second hour.');
    expect(merged.discussion_log).toBe('Rush.\n\nFormal.');
    expect(merged.decisions.map((d) => d.text)).toEqual([
      'Approved the DJ.',
      'Raised dues.',
    ]);
    expect(merged.open_questions).toEqual(['Who books it?']);
  });

  it('takes a TL;DR bullet from each part in turn, each once (#5523)', () => {
    const merged = mergeParts([
      {
        ...empty,
        tldr: '- DJ approved\n- Rush starts Monday\n- Shirts on sale',
      },
      { ...empty, tldr: '- Rush starts Monday\n- Pay dues by Friday' },
      { ...empty, tldr: '- Formal is December 5' },
    ]);
    expect(merged.tldr).toBe(
      [
        '- DJ approved',
        '- Rush starts Monday',
        '- Formal is December 5',
        '- Pay dues by Friday',
        '- Shirts on sale',
      ].join('\n'),
    );
  });
});

describe('recovering a quote that misses its line only in how it is written', () => {
  const sources: MinutesSource[] = [
    {
      id: 'S1',
      kind: 'recording',
      label: 'Recording',
      standing: null,
      rank: 0,
      userId: null,
      text: [
        'Speaker 2: All in favor of the $1,200 DJ? That’s 22 to 5, motion passes.',
        'Speaker 1: Can you handle the venue deposit, Jake?',
        'Speaker 1: Can you handle the venue deposit, Jake? Again.',
      ].join('\n'),
    },
  ];

  it('puts the line back word for word', () => {
    expect(
      recoverQuote(
        "all in favor of the $1,200 DJ? that's 22 to 5,  motion passes",
        sources,
      ),
    ).toBe(
      'Speaker 2: All in favor of the $1,200 DJ? That’s 22 to 5, motion passes.',
    );
  });

  it('leaves a quote two lines could be, and one no line holds', () => {
    const ambiguous = 'can you handle the venue deposit, jake';
    expect(recoverQuote(ambiguous, sources)).toBe(ambiguous);
    expect(recoverQuote('dues go up by fifty dollars', sources)).toBe(
      'dues go up by fifty dollars',
    );
  });
});
