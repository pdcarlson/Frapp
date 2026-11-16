import {
  DEFAULT_MEETING_SECTIONS,
  MeetingDraftOutputSchema,
} from '@repo/validation';
import { buildMinutesDraftPrompt } from '#domain/utils/minutes-draft';
import { scriptedMinutesDraft } from './scripted-minutes-draft';

/**
 * The scripted reply reads the notes and the roster out of the real prompt
 * by its layout, so a change to that layout would quietly empty the local,
 * no-key flow. This pins the two together.
 */
describe('scriptedMinutesDraft', () => {
  it('drafts from the notes in the product prompt', async () => {
    const prompt = buildMinutesDraftPrompt({
      meetingName: 'Chapter meeting',
      meetingType: 'chapter',
      otherLabel: null,
      meetingDate: '2026-11-09',
      sections: DEFAULT_MEETING_SECTIONS,
      roster: [
        {
          userId: 'u-1',
          name: 'Ryan Castellano',
          roles: ['Member'],
          checkedIn: true,
        },
      ],
      notes: [
        'voted yes on formal budget 30-2',
        'Ryan Castellano will send the sign up sheet',
        'someone needs to call the venue',
      ].join('\n'),
    });
    const reply = scriptedMinutesDraft({
      messages: prompt.messages,
    } as never);
    const draft = MeetingDraftOutputSchema.parse(
      (reply as { object: unknown }).object,
    );
    expect(draft.decisions).toEqual([
      expect.objectContaining({
        vote: { for: 30, against: 2, abstain: 0 },
        quote: 'voted yes on formal budget 30-2',
      }),
    ]);
    expect(draft.action_items.map((item) => item.owner)).toEqual([
      'Ryan Castellano',
      null,
    ]);
    expect(draft.open_questions).toHaveLength(1);
  });

  it('reads several sources and lists a disagreement between them (#4935)', () => {
    const base = {
      kind: 'notes' as const,
      standing: null,
      rank: 1,
      userId: null,
    };
    const prompt = buildMinutesDraftPrompt({
      meetingName: 'Chapter meeting',
      meetingType: 'chapter',
      otherLabel: null,
      meetingDate: '2026-11-09',
      sections: DEFAULT_MEETING_SECTIONS,
      roster: [],
      sources: [
        {
          ...base,
          id: 'S1',
          label: 'Eli Sorensen',
          text: 'voted on formal budget, passed 22-5\nreminder: dues Nov 20',
        },
        {
          ...base,
          id: 'S2',
          label: 'Sam Abernathy',
          text: 'formal budget voted, passed 21-6\nreminder: dues Nov 20',
        },
      ],
    });
    const draft = MeetingDraftOutputSchema.parse(
      (
        scriptedMinutesDraft({ messages: prompt.messages } as never) as {
          object: unknown;
        }
      ).object,
    );
    expect(draft.decisions).toEqual([]);
    expect(draft.conflicts).toEqual([
      expect.objectContaining({
        kind: 'decision',
        versions: [
          expect.objectContaining({
            source: 'S1',
            vote: { for: 22, against: 5, abstain: 0 },
          }),
          expect.objectContaining({
            source: 'S2',
            vote: { for: 21, against: 6, abstain: 0 },
          }),
        ],
      }),
    ]);
  });
});
