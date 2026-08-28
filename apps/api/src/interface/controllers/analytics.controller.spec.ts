import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ContentFreePropertyError } from '@repo/validation';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from '../../application/services/analytics.service';
import { TrackEventDto } from '../dtos/analytics.dto';

const USER_ID = 'user-1';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analytics: jest.Mocked<
    Pick<AnalyticsService, 'getDistinctId' | 'trackFromClient'>
  >;

  beforeEach(() => {
    // Thin controller: instantiate directly so the test exercises the handler's
    // delegation + error mapping without the guard/interceptor DI graph.
    analytics = {
      getDistinctId: jest.fn(),
      trackFromClient: jest.fn(),
    };
    controller = new AnalyticsController(analytics);
  });

  describe('getIdentity', () => {
    it('returns the pseudonymous id and enabled=true when configured', () => {
      analytics.getDistinctId.mockReturnValue('hash-abc');

      expect(controller.getIdentity(USER_ID)).toEqual({
        distinct_id: 'hash-abc',
        enabled: true,
      });
    });

    it('returns enabled=false when analytics is unconfigured', () => {
      analytics.getDistinctId.mockReturnValue(null);

      expect(controller.getIdentity(USER_ID)).toEqual({
        distinct_id: null,
        enabled: false,
      });
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
