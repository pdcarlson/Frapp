import { NotFoundException } from '@nestjs/common';
import { ChatCategoryService } from './chat-category.service';
import {
  createChatServiceFixture,
  type ChatServiceFixture,
} from '#test/helpers/chat-service.fixture';

// Moved out of `chat.service.spec.ts` with the methods (#1380).
describe('ChatCategoryService', () => {
  let categories: ChatCategoryService;
  let mockCategoryRepo: ChatServiceFixture['mockCategoryRepo'];
  let mockTierRepo: ChatServiceFixture['mockTierRepo'];
  let mockChannelCache: ChatServiceFixture['mockChannelCache'];

  beforeEach(async () => {
    ({ categories, mockCategoryRepo, mockTierRepo, mockChannelCache } =
      await createChatServiceFixture());
  });

  describe('getCategories', () => {
    it("lists the caller chapter's categories", async () => {
      mockCategoryRepo.findByChapter.mockResolvedValue([]);

      await categories.getCategories('ch-1');

      expect(mockCategoryRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    });
  });

  describe('createCategory', () => {
    it('defaults display_order to 0 when none is given', async () => {
      await categories.createCategory({ chapter_id: 'ch-1', name: 'Rush' });

      expect(mockCategoryRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Rush',
        display_order: 0,
        who_can_see: null,
        who_can_post: null,
      });
    });

    it('keeps an explicit display_order', async () => {
      await categories.createCategory({
        chapter_id: 'ch-1',
        name: 'Rush',
        display_order: 3,
      });

      expect(mockCategoryRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Rush',
        display_order: 3,
        who_can_see: null,
        who_can_post: null,
      });
    });
  });

  describe('deleteCategory', () => {
    const baseCategory = {
      id: 'cat-1',
      chapter_id: 'ch-1',
      name: 'General',
      display_order: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      who_can_see: null,
      who_can_post: null,
    };

    it('should delete category by id', async () => {
      mockCategoryRepo.findById.mockResolvedValue(baseCategory);
      mockCategoryRepo.delete.mockResolvedValue();

      await categories.deleteCategory('cat-1', 'ch-1');
      expect(mockCategoryRepo.findById).toHaveBeenCalledWith('cat-1', 'ch-1');
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith('cat-1', 'ch-1');
    });

    // The repository filters on the chapter it is handed, so both the lookup
    // and the write must carry the caller's chapter: a wrong one threaded
    // through both would rename another chapter's category.
    it('should scope both the lookup and the update to the caller chapter', async () => {
      mockCategoryRepo.findById.mockResolvedValue(baseCategory);
      mockCategoryRepo.update.mockResolvedValue({
        ...baseCategory,
        name: 'Renamed',
      });

      await categories.updateCategory('cat-1', 'ch-1', { name: 'Renamed' });

      expect(mockCategoryRepo.findById).toHaveBeenCalledWith('cat-1', 'ch-1');
      expect(mockCategoryRepo.update).toHaveBeenCalledWith('cat-1', 'ch-1', {
        name: 'Renamed',
      });
    });

    // chat_channels.category_id is ON DELETE SET NULL, so an unscoped delete
    // would silently un-categorize another tenant's channels.
    it('should not delete a category belonging to another chapter', async () => {
      mockCategoryRepo.findById.mockResolvedValue(null);

      await expect(
        categories.deleteCategory('cat-1', 'ch-other'),
      ).rejects.toThrow(NotFoundException);
      expect(mockCategoryRepo.delete).not.toHaveBeenCalled();
    });

    it('should not update a category belonging to another chapter', async () => {
      mockCategoryRepo.findById.mockResolvedValue(null);

      await expect(
        categories.updateCategory('cat-1', 'ch-other', { name: 'Renamed' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockCategoryRepo.update).not.toHaveBeenCalled();
    });
  });

  // Who can see and post (#3722): a category's lists reach the channels in
  // it that matched it, through one transaction in the database.
  describe('who can see and post', () => {
    const TIER = '00000000-0000-4000-8000-0000000000e1';
    const category = {
      id: 'cat-1',
      chapter_id: 'ch-1',
      name: 'Exec',
      display_order: 0,
      created_at: '',
      who_can_see: null,
      who_can_post: null,
    };
    beforeEach(() => {
      mockTierRepo.findByChapter.mockResolvedValue([
        { id: TIER, chapter_id: 'ch-1' },
      ]);
    });

    it('creates a category with lists, checked against the chapter', async () => {
      await categories.createCategory({
        chapter_id: 'ch-1',
        name: 'Exec',
        who_can_see: [`tier:${TIER}`],
      });

      expect(mockCategoryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          who_can_see: [`tier:${TIER}`],
          who_can_post: null,
        }),
      );
    });

    it('sets the lists through setAccess and drops the channels that followed from the cache', async () => {
      mockCategoryRepo.findById.mockResolvedValue(category);
      mockCategoryRepo.setAccess.mockResolvedValue(['chan-a', 'chan-b']);

      const updated = await categories.updateCategory('cat-1', 'ch-1', {
        who_can_see: [`tier:${TIER}`],
      });

      expect(mockCategoryRepo.setAccess).toHaveBeenCalledWith(
        'ch-1',
        'cat-1',
        [`tier:${TIER}`],
        null,
      );
      expect(mockCategoryRepo.update).not.toHaveBeenCalled();
      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-a');
      expect(mockChannelCache.invalidate).toHaveBeenCalledWith('chan-b');
      expect(updated).toMatchObject({
        who_can_see: [`tier:${TIER}`],
        who_can_post: null,
      });
    });

    it('keeps the list it is not sent', async () => {
      mockCategoryRepo.findById.mockResolvedValue({
        ...category,
        who_can_see: [`tier:${TIER}`],
      });
      mockCategoryRepo.setAccess.mockResolvedValue([]);

      await categories.updateCategory('cat-1', 'ch-1', {
        who_can_post: [`tier:${TIER}`],
      });

      expect(mockCategoryRepo.setAccess).toHaveBeenCalledWith(
        'ch-1',
        'cat-1',
        [`tier:${TIER}`],
        [`tier:${TIER}`],
      );
    });

    it('refuses a tier from another chapter before writing anything', async () => {
      mockCategoryRepo.findById.mockResolvedValue(category);

      await expect(
        categories.updateCategory('cat-1', 'ch-1', {
          name: 'Board',
          who_can_see: ['tier:00000000-0000-4000-8000-0000000000ff'],
        }),
      ).rejects.toThrow("That tier isn't in this chapter anymore");
      expect(mockCategoryRepo.setAccess).not.toHaveBeenCalled();
      expect(mockCategoryRepo.update).not.toHaveBeenCalled();
    });

    it('leaves the lists alone on a rename', async () => {
      mockCategoryRepo.findById.mockResolvedValue(category);
      mockCategoryRepo.update.mockResolvedValue({ ...category, name: 'Board' });

      await categories.updateCategory('cat-1', 'ch-1', { name: 'Board' });

      expect(mockCategoryRepo.setAccess).not.toHaveBeenCalled();
    });
  });
});
