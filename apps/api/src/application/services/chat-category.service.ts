import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHAT_CATEGORY_REPOSITORY,
  type IChatCategoryRepository,
} from '#domain/repositories/chat.repository.interface';
import type { ChatChannelCategory } from '#domain/entities/chat.entity';

export interface CreateCategoryInput {
  chapter_id: string;
  name: string;
  display_order?: number;
}

/**
 * A chapter's channel categories: the sidebar's officer-managed groupings.
 *
 * Split out of `ChatService` (#1380). It reads and writes only
 * `chat_channel_categories`, and nothing on the chat hot path calls it. The
 * routes' `channels:manage` gate lives on the controller; the chapter scoping
 * lives here, in every lookup.
 */
@Injectable()
export class ChatCategoryService {
  constructor(
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
  ) {}

  async getCategories(chapterId: string): Promise<ChatChannelCategory[]> {
    return this.categoryRepo.findByChapter(chapterId);
  }

  async createCategory(
    input: CreateCategoryInput,
  ): Promise<ChatChannelCategory> {
    return this.categoryRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      display_order: input.display_order ?? 0,
    });
  }

  /**
   * Categories are chapter-scoped, so a caller holding `channels:manage` in
   * their own chapter must not be able to reach another chapter's category by
   * UUID. Mirrors the channel pattern: resolve within the active chapter first
   * (404 when it does not belong there), then mutate through a chapter-scoped
   * repository call so the filter is enforced at the query too.
   */
  async getCategory(
    id: string,
    chapterId: string,
  ): Promise<ChatChannelCategory> {
    const category = await this.categoryRepo.findById(id, chapterId);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async updateCategory(
    id: string,
    chapterId: string,
    data: { name?: string; display_order?: number },
  ): Promise<ChatChannelCategory> {
    await this.getCategory(id, chapterId);
    return this.categoryRepo.update(id, chapterId, data);
  }

  async deleteCategory(id: string, chapterId: string): Promise<void> {
    await this.getCategory(id, chapterId);
    await this.categoryRepo.delete(id, chapterId);
  }
}
