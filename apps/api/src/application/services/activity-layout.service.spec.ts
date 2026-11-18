import { BadRequestException } from '@nestjs/common';
import { ACTIVITY_LAYOUT_MAX_KEYS } from '@repo/validation';
import type { IActivityLayoutRepository } from '#domain/repositories/activity-layout.repository.interface';
import type { ActivityLayout } from '#domain/entities/activity-layout.entity';
import { ActivityLayoutService } from './activity-layout.service';

const CHAPTER = 'chapter-1';
const USER = 'user-1';

const row = (overrides: Partial<ActivityLayout> = {}): ActivityLayout => ({
  user_id: USER,
  chapter_id: CHAPTER,
  card_order: ['todo', 'calendar'],
  hidden_cards: ['links'],
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z',
  ...overrides,
});

describe('ActivityLayoutService', () => {
  let repo: jest.Mocked<IActivityLayoutRepository>;
  let service: ActivityLayoutService;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    };
    service = new ActivityLayoutService(repo);
  });

  describe('get', () => {
    it('answers empty lists and saved=false for a member with no row', async () => {
      repo.find.mockResolvedValue(null);

      await expect(service.get(CHAPTER, USER)).resolves.toEqual({
        card_order: [],
        hidden_cards: [],
        saved: false,
      });
      expect(repo.find).toHaveBeenCalledWith(CHAPTER, USER);
    });

    it("answers the member's row with saved=true", async () => {
      repo.find.mockResolvedValue(row());

      await expect(service.get(CHAPTER, USER)).resolves.toEqual({
        card_order: ['todo', 'calendar'],
        hidden_cards: ['links'],
        saved: true,
      });
    });
  });

  describe('save', () => {
    it('upserts both lists, chapter first, and answers saved=true', async () => {
      repo.upsert.mockResolvedValue(
        row({ card_order: ['recap', 'todo'], hidden_cards: [] }),
      );

      await expect(
        service.save(CHAPTER, USER, {
          card_order: ['recap', 'todo'],
          hidden_cards: [],
        }),
      ).resolves.toEqual({
        card_order: ['recap', 'todo'],
        hidden_cards: [],
        saved: true,
      });
      expect(repo.upsert).toHaveBeenCalledWith(CHAPTER, USER, {
        card_order: ['recap', 'todo'],
        hidden_cards: [],
      });
    });

    it('accepts a well-formed key this build does not know', async () => {
      repo.upsert.mockResolvedValue(row({ card_order: ['future-card-2'] }));

      await service.save(CHAPTER, USER, {
        card_order: ['future-card-2'],
        hidden_cards: [],
      });

      expect(repo.upsert).toHaveBeenCalled();
    });

    it('accepts two empty lists', async () => {
      repo.upsert.mockResolvedValue(row({ card_order: [], hidden_cards: [] }));

      await service.save(CHAPTER, USER, { card_order: [], hidden_cards: [] });

      expect(repo.upsert).toHaveBeenCalled();
    });

    it.each([
      ['an upper-case key', { card_order: ['Todo'], hidden_cards: [] }],
      ['a key starting with a digit', { card_order: [], hidden_cards: ['1x'] }],
      ['an empty key', { card_order: [''], hidden_cards: [] }],
      [
        'a key over 32 characters',
        { card_order: ['a'.repeat(33)], hidden_cards: [] },
      ],
      ['a key with a space', { card_order: ['to do'], hidden_cards: [] }],
      [
        'a key twice in one list',
        { card_order: ['todo', 'todo'], hidden_cards: [] },
      ],
      ['a key in both lists', { card_order: ['todo'], hidden_cards: ['todo'] }],
      [
        'too many shown cards',
        {
          card_order: Array.from(
            { length: ACTIVITY_LAYOUT_MAX_KEYS + 1 },
            (_, i) => `card-${i}`,
          ),
          hidden_cards: [],
        },
      ],
      [
        'too many hidden cards',
        {
          card_order: [],
          hidden_cards: Array.from(
            { length: ACTIVITY_LAYOUT_MAX_KEYS + 1 },
            (_, i) => `card-${i}`,
          ),
        },
      ],
    ])('refuses %s with 400 and writes nothing', async (_name, body) => {
      await expect(service.save(CHAPTER, USER, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('accepts exactly the most keys a list may hold', async () => {
      const card_order = Array.from(
        { length: ACTIVITY_LAYOUT_MAX_KEYS },
        (_, i) => `card-${i}`,
      );
      repo.upsert.mockResolvedValue(row({ card_order }));

      await service.save(CHAPTER, USER, { card_order, hidden_cards: [] });

      expect(repo.upsert).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it("deletes the member's row, chapter first", async () => {
      repo.delete.mockResolvedValue(undefined);

      await service.reset(CHAPTER, USER);

      expect(repo.delete).toHaveBeenCalledWith(CHAPTER, USER);
    });
  });
});
