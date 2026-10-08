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

  beforeEach(async () => {
    ({ categories, mockCategoryRepo } = await createChatServiceFixture());
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
});
