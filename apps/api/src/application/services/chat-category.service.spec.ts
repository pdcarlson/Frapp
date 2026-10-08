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
      expect(mockCategoryRepo.delete).toHaveBeenCalledWith('cat-1', 'ch-1');
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
