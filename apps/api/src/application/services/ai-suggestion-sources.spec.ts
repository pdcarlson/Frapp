import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ChannelSuggestionSource,
  EventSuggestionSource,
  MeetingSuggestionSource,
} from './ai-suggestion-sources';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const OPEN = '33333333-3333-4333-8333-333333333333';
const HIDDEN = '44444444-4444-4444-8444-444444444444';

describe('AI suggestion source access (#4309)', () => {
  describe('EventSuggestionSource', () => {
    const build = (findById: jest.Mock) =>
      new EventSuggestionSource({ findById } as never);

    it('keeps the events the viewer can open, asking once per event', async () => {
      const findById = jest.fn(async (eventId: string) => {
        if (eventId === HIDDEN) throw new NotFoundException();
        return { id: eventId };
      });
      const open = await build(findById).filterOpenable(CHAPTER, USER, [
        OPEN,
        HIDDEN,
        OPEN,
      ]);
      expect([...open]).toEqual([OPEN]);
      expect(findById).toHaveBeenCalledTimes(2);
      expect(findById).toHaveBeenCalledWith(OPEN, CHAPTER, USER);
    });

    it('fails the read on anything but not-found, instead of guessing', async () => {
      const findById = jest.fn(async () => {
        throw new ForbiddenException();
      });
      await expect(
        build(findById).filterOpenable(CHAPTER, USER, [OPEN]),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('ChannelSuggestionSource', () => {
    it('asks the channel read rule, archived channels included', async () => {
      const filterAccessibleChannelIds = jest.fn(async () => new Set([OPEN]));
      const source = new ChannelSuggestionSource({
        filterAccessibleChannelIds,
      } as never);
      const open = await source.filterOpenable(CHAPTER, USER, [OPEN, HIDDEN]);
      expect([...open]).toEqual([OPEN]);
      expect(filterAccessibleChannelIds).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        [OPEN, HIDDEN],
        { includeArchived: true },
      );
    });
  });

  describe('MeetingSuggestionSource (#4313)', () => {
    it('asks the one read rule for minutes, and nothing else', async () => {
      const readableAmong = jest.fn(async () => new Set([OPEN]));
      const source = new MeetingSuggestionSource({ readableAmong } as never);
      const open = await source.filterOpenable(CHAPTER, USER, [OPEN, HIDDEN]);
      expect(source.sourceType).toBe('meeting');
      expect([...open]).toEqual([OPEN]);
      expect(readableAmong).toHaveBeenCalledWith(CHAPTER, USER, [OPEN, HIDDEN]);
    });
  });
});
