import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertContentFreeProperties } from '@repo/validation';
import {
  ASK_RATED_EVENT,
  ASK_RATING_CLEARED_EVENT,
  ASK_SIGNAL_EVENT,
  AskFeedbackService,
} from './ask-feedback.service';

const ASK = '0a000000-0000-4000-8000-000000004902';
const CHAPTER = '0b000000-0000-4000-8000-000000004902';
const ASKER = '0c000000-0000-4000-8000-000000004902';
const OTHER = '0d000000-0000-4000-8000-000000004902';
const NOW = new Date('2026-11-13T20:05:00.000Z');
const TRACE = {
  id: ASK,
  door: 'ask',
  prompt_version: 'ask.answer@v4',
  model: 'claude-sonnet-5-5',
  effort: 'default',
  outcome: 'answered',
};

function build() {
  let feedback: { rating: string; reason: string | null } | null = null;
  const traces = {
    // The trace is the asker's, in this chapter, and nobody else's.
    findForAsker: jest.fn(
      async (askId: string, chapterId: string, userId: string) =>
        askId === ASK && chapterId === CHAPTER && userId === ASKER
          ? TRACE
          : null,
    ),
    upsertFeedback: jest.fn(
      async (input: { rating: string; reason: string | null; now: Date }) => {
        feedback = { rating: input.rating, reason: input.reason };
        return {
          ask_id: ASK,
          chapter_id: CHAPTER,
          user_id: ASKER,
          ...feedback,
          created_at: NOW.toISOString(),
          updated_at: input.now.toISOString(),
        };
      },
    ),
    deleteFeedback: jest.fn(async () => {
      const had = feedback !== null;
      feedback = null;
      return had;
    }),
  };
  const analytics = { track: jest.fn(async () => undefined) };
  const service = new AskFeedbackService(traces as never, analytics as never);
  const events = () =>
    analytics.track.mock.calls as unknown as [
      string,
      string,
      { chapterId: string; properties: Record<string, unknown> },
    ][];
  return { service, traces, analytics, events, current: () => feedback };
}

const mine = { chapterId: CHAPTER, userId: ASKER, askId: ASK };

describe('AskFeedbackService', () => {
  it('takes the asker’s thumbs and answers with what is held', async () => {
    const { service, traces } = build();
    await expect(service.rate(mine, 'up', null, NOW)).resolves.toEqual(
      expect.objectContaining({ ask_id: ASK, rating: 'up', reason: null }),
    );
    expect(traces.upsertFeedback).toHaveBeenCalledWith({
      askId: ASK,
      chapterId: CHAPTER,
      userId: ASKER,
      rating: 'up',
      reason: null,
      now: NOW,
    });
  });

  it('a second thumbs replaces the first: one per answer, changeable', async () => {
    const { service, current } = build();
    await service.rate(mine, 'up', null, NOW);
    await service.rate(mine, 'down', null, NOW);
    expect(current()).toEqual({ rating: 'down', reason: null });
    await service.rate(mine, 'down', 'missed', NOW);
    expect(current()).toEqual({ rating: 'down', reason: 'missed' });
  });

  it('refuses another member’s ask, another chapter’s, and one that does not exist, all alike', async () => {
    const { service, traces } = build();
    const refusals = await Promise.all(
      [
        { ...mine, userId: OTHER },
        { ...mine, chapterId: OTHER },
        { ...mine, askId: OTHER },
      ].map((actor) =>
        service
          .rate(actor, 'down', 'wrong', NOW)
          .catch((error: unknown) => error),
      ),
    );
    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(NotFoundException);
      expect((refusal as NotFoundException).getResponse()).toEqual(
        expect.objectContaining({ code: 'ai.ask.feedback.not_found' }),
      );
    }
    expect(traces.upsertFeedback).not.toHaveBeenCalled();
  });

  it('refuses a reason on a thumbs up before reading anything', async () => {
    const { service, traces } = build();
    await expect(service.rate(mine, 'up', 'wrong', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(traces.findForAsker).not.toHaveBeenCalled();
  });

  it('answers not found when the trace went away between the read and the write', async () => {
    const { service, traces, analytics } = build();
    traces.upsertFeedback.mockResolvedValueOnce(null as never);
    await expect(service.rate(mine, 'down', null, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('a thumbs sends one event with the turn’s codes and no content', async () => {
    const { service, events } = build();
    await service.rate(mine, 'down', 'too_long', NOW);
    expect(events()).toHaveLength(1);
    const [name, userId, options] = events()[0];
    expect(name).toBe(ASK_RATED_EVENT);
    expect(userId).toBe(ASKER);
    expect(options.properties).toEqual({
      ask_id: ASK,
      rating: 'down',
      reason: 'too_long',
      door: 'ask',
      prompt_version: 'ask.answer@v4',
      model: 'claude-sonnet-5-5',
      effort: 'default',
      outcome: 'answered',
    });
    expect(() =>
      assertContentFreeProperties({
        name,
        properties: options.properties as never,
      }),
    ).not.toThrow();
  });

  it('a failed event never costs the member their thumbs', async () => {
    const { service, analytics } = build();
    analytics.track.mockRejectedValueOnce(new Error('posthog down'));
    await expect(service.rate(mine, 'up', null, NOW)).resolves.toEqual(
      expect.objectContaining({ rating: 'up' }),
    );
  });

  it('takes a thumbs back, and is fine with none to take', async () => {
    const { service, events, current } = build();
    await service.rate(mine, 'up', null, NOW);
    await service.clear(mine);
    expect(current()).toBeNull();
    expect(events().map((call) => call[0])).toEqual([
      ASK_RATED_EVENT,
      ASK_RATING_CLEARED_EVENT,
    ]);
    await service.clear(mine);
    expect(events()).toHaveLength(2);
  });

  it('only the asker can take a thumbs back', async () => {
    const { service, traces } = build();
    await expect(
      service.clear({ ...mine, userId: OTHER }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(traces.deleteFeedback).not.toHaveBeenCalled();
  });

  it('a signal is an event and nothing else, and only on the asker’s own answer', async () => {
    const { service, traces, events } = build();
    await service.signal(mine, 'source_opened');
    expect(events()).toEqual([
      [
        ASK_SIGNAL_EVENT,
        ASKER,
        expect.objectContaining({
          chapterId: CHAPTER,
          properties: expect.objectContaining({
            ask_id: ASK,
            signal: 'source_opened',
          }),
        }),
      ],
    ]);
    expect(traces.upsertFeedback).not.toHaveBeenCalled();
    await expect(
      service.signal({ ...mine, userId: OTHER }, 'retried'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(events()).toHaveLength(1);
  });
});
