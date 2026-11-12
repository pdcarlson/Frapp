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
    const reply = await scriptedMinutesDraft({
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
});
