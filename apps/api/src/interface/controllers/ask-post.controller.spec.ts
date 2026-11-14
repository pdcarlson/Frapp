import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  assertContentFreeProperties,
  type AnalyticsProperties,
} from '@repo/validation';
import type { AskPostService } from '../../application/services/ask-post/ask-post.service';
import type { AnalyticsService } from '../../application/services/analytics.service';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import {
  ASK_ANSWER_POSTED_EVENT,
  AskPostController,
} from './ask-post.controller';

const CHAPTER = 'c0ffee00-0000-4000-8000-000000000001';
const USER = 'c0ffee00-0000-4000-8000-0000000000a1';
const CHANNEL = 'c0ffee00-0000-4000-8000-4000000000b2';

function build(outcome: {
  posted: boolean;
  restricted: { key: string; kind: string; title: string }[];
}) {
  const post = jest.fn().mockResolvedValue(outcome);
  const track = jest.fn().mockResolvedValue(undefined);
  const controller = new AskPostController(
    { post } as unknown as AskPostService,
    { track } as unknown as AnalyticsService,
  );
  const call = (dto: {
    confirm: boolean;
    acknowledged?: string[];
  }): ReturnType<AskPostController['post']> =>
    controller.post(
      CHAPTER,
      USER,
      { channel_id: CHANNEL, receipt: 'sealed', ...dto },
      { headers: {} },
    );
  return { post, track, call };
}

describe('AskPostController', () => {
  it('runs the same guards as asking, the AI switch first', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AskPostController)).toEqual([
      AiEnabledGuard,
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
  });

  it('posts for the signed-in member in their chapter, never for ids in the body', async () => {
    const { post, call } = build({ posted: true, restricted: [] });
    await call({ confirm: true });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: CHAPTER,
        userId: USER,
        channelId: CHANNEL,
        receipt: 'sealed',
        confirm: true,
        acknowledged: [],
      }),
    );
  });

  it('counts a post with whether it was warned, and nothing of what was posted', async () => {
    const { track, call } = build({
      posted: true,
      restricted: [
        { key: 'tool:my_tasks', kind: 'tasks', title: 'Your tasks' },
      ],
    });
    await call({ confirm: true, acknowledged: ['tool:my_tasks'] });
    expect(track).toHaveBeenCalledTimes(1);
    const [event, userId, options] = track.mock.calls[0] as [
      string,
      string,
      { chapterId: string; properties: AnalyticsProperties },
    ];
    expect(event).toBe(ASK_ANSWER_POSTED_EVENT);
    expect(userId).toBe(USER);
    expect(options.chapterId).toBe(CHAPTER);
    expect(options.properties).toEqual({ warned: true });
    expect(() =>
      assertContentFreeProperties({
        name: event,
        properties: options.properties,
      }),
    ).not.toThrow();
  });

  it('counts nothing for a check, or for a post held back by a changed list', async () => {
    const check = build({ posted: false, restricted: [] });
    await check.call({ confirm: false });
    expect(check.track).not.toHaveBeenCalled();
  });

  it('posts even when the count cannot be sent', async () => {
    const { track, call } = build({ posted: true, restricted: [] });
    track.mockRejectedValue(new Error('analytics down'));
    await expect(call({ confirm: true })).resolves.toEqual({
      posted: true,
      restricted: [],
    });
  });
});
