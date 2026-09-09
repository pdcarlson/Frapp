import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentFreePropertyError } from '@repo/validation';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from '../../application/services/analytics.service';
import { TrackEventDto } from '../dtos/analytics.dto';

const USER_ID = 'user-1';
const CHAPTER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const USER_HEX = 'a'.repeat(64);
const CHAPTER_HEX = 'b'.repeat(64);

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analytics: jest.Mocked<
    Pick<
      AnalyticsService,
      'getDistinctId' | 'getChapterGroupId' | 'trackFromClient'
    >
  >;

  beforeEach(() => {
    // Thin controller: instantiate directly so the test exercises the handler's
    // delegation + error mapping without the guard/interceptor DI graph.
    analytics = {
      getDistinctId: jest.fn(),
      getChapterGroupId: jest.fn(),
      trackFromClient: jest.fn(),
    };
    controller = new AnalyticsController(analytics);
  });

  describe('getIdentity', () => {
    it('returns validated pseudonyms when a chapter is in context', () => {
      analytics.getDistinctId.mockReturnValue(USER_HEX);
      analytics.getChapterGroupId.mockReturnValue(CHAPTER_HEX);

      expect(controller.getIdentity(USER_ID, CHAPTER_ID)).toEqual({
        distinct_id: USER_HEX,
        enabled: true,
        chapter_group_id: CHAPTER_HEX,
      });
      expect(analytics.getDistinctId).toHaveBeenCalledWith(USER_ID);
      expect(analytics.getChapterGroupId).toHaveBeenCalledWith(CHAPTER_ID);
    });

    it('returns chapter_group_id=null when no chapter is in context', () => {
      analytics.getDistinctId.mockReturnValue(USER_HEX);
      analytics.getChapterGroupId.mockReturnValue(null);

      expect(controller.getIdentity(USER_ID)).toEqual({
        distinct_id: USER_HEX,
        enabled: true,
        chapter_group_id: null,
      });
      expect(analytics.getChapterGroupId).toHaveBeenCalledWith(undefined);
    });

    it('returns a different chapter_group_id when the chapter changes', () => {
      analytics.getDistinctId.mockReturnValue(USER_HEX);
      analytics.getChapterGroupId.mockImplementation((chapterId) =>
        chapterId === CHAPTER_ID ? CHAPTER_HEX : 'c'.repeat(64),
      );

      expect(controller.getIdentity(USER_ID, CHAPTER_ID).chapter_group_id).toBe(
        CHAPTER_HEX,
      );
      expect(
        controller.getIdentity(USER_ID, OTHER_CHAPTER_ID).chapter_group_id,
      ).toBe('c'.repeat(64));
    });

    it('returns enabled=false when analytics is unconfigured', () => {
      analytics.getDistinctId.mockReturnValue(null);
      analytics.getChapterGroupId.mockReturnValue(null);

      expect(controller.getIdentity(USER_ID, CHAPTER_ID)).toEqual({
        distinct_id: null,
        enabled: false,
        chapter_group_id: null,
      });
    });

    it('never puts raw user or chapter ids on the payload', () => {
      analytics.getDistinctId.mockReturnValue(USER_HEX);
      analytics.getChapterGroupId.mockReturnValue(CHAPTER_HEX);

      const payload = JSON.stringify(
        controller.getIdentity(USER_ID, CHAPTER_ID),
      );
      expect(payload).not.toContain(USER_ID);
      expect(payload).not.toContain(CHAPTER_ID);
    });
  });

  describe('track', () => {
    it('delegates to trackFromClient (the membership/opt-out boundary) and returns success', async () => {
      const dto: TrackEventDto = {
        name: 'opened-channel',
        chapter_id: 'chapter-1',
        properties: { channel_kind: 'general' },
      };
      analytics.trackFromClient.mockResolvedValue(undefined);

      const result = await controller.track(USER_ID, dto);

      expect(analytics.trackFromClient).toHaveBeenCalledWith(
        'opened-channel',
        USER_ID,
        { chapterId: 'chapter-1', properties: { channel_kind: 'general' } },
      );
      expect(result).toEqual({ success: true });
    });

    it('propagates a ForbiddenException from the service (non-member → 403)', async () => {
      analytics.trackFromClient.mockRejectedValueOnce(
        new ForbiddenException('Not a member of this chapter'),
      );

      await expect(
        controller.track(USER_ID, {
          name: 'opened-channel',
          chapter_id: 'foreign-chapter',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('maps a content/PII payload error to BadRequestException (400)', async () => {
      analytics.trackFromClient.mockRejectedValueOnce(
        new ContentFreePropertyError('properties look like content'),
      );

      await expect(
        controller.track(USER_ID, { name: 'sent-message' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rethrows an unexpected server fault unchanged (→ 500)', async () => {
      const fault = new Error('db down');
      analytics.trackFromClient.mockRejectedValueOnce(fault);

      await expect(
        controller.track(USER_ID, { name: 'opened-channel' }),
      ).rejects.toBe(fault);
    });
  });
});
