import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CHAT_CATEGORY_REPOSITORY,
  type IChatCategoryRepository,
} from '#domain/repositories/chat.repository.interface';
import type { ChatChannelCategory } from '#domain/entities/chat.entity';
import { ChannelAccessListService } from './channel-access-list.service';
import { ChannelCacheService } from './channel-cache.service';

export interface CreateCategoryInput {
  chapter_id: string;
  name: string;
  display_order?: number;
  /** `null` or left out: everyone in the chapter (#3722). */
  who_can_see?: string[] | null;
  /** `null` or left out: everyone who can see. */
  who_can_post?: string[] | null;
}

export interface UpdateCategoryInput {
  name?: string;
  display_order?: number;
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
}

/**
 * A chapter's channel categories: the sidebar's officer-managed groupings.
 *
 * Split out of `ChatService` (#1380). It reads and writes only
 * `chat_channel_categories`, and nothing on the chat hot path calls it. The
 * routes' `channels:manage` gate lives on the controller; the chapter scoping
 * lives here, in every lookup.
 *
 * A category also answers who can see and who can post (#3722) for the
 * channels in it that match it: a new channel copies its lists, and a change
 * to them reaches every channel that still matched the old ones, the way a
 * Discord channel synced to its category follows it.
 */
@Injectable()
export class ChatCategoryService {
  constructor(
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
    private readonly accessLists: ChannelAccessListService,
    private readonly channelCache: ChannelCacheService,
  ) {}

  async getCategories(chapterId: string): Promise<ChatChannelCategory[]> {
    return this.categoryRepo.findByChapter(chapterId);
  }

  async createCategory(
    input: CreateCategoryInput,
  ): Promise<ChatChannelCategory> {
    const lists = await this.accessLists.normalize(input.chapter_id, {
      who_can_see: input.who_can_see,
      who_can_post: input.who_can_post,
    });
    return this.categoryRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      display_order: input.display_order ?? 0,
      who_can_see: lists.who_can_see ?? null,
      who_can_post: lists.who_can_post ?? null,
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

  /**
   * Name and order are a plain update. A change to either list goes through
   * `setAccess`, which moves the matching channels with it in one
   * transaction, and those channels leave the channel cache, since who can
   * see one decides who its pushes reach.
   */
  async updateCategory(
    id: string,
    chapterId: string,
    data: UpdateCategoryInput,
  ): Promise<ChatChannelCategory> {
    const existing = await this.getCategory(id, chapterId);
    const { who_can_see: whoCanSee, who_can_post: whoCanPost, ...plain } = data;
    let updated =
      Object.keys(plain).length > 0
        ? await this.categoryRepo.update(id, chapterId, plain)
        : existing;
    if (whoCanSee !== undefined || whoCanPost !== undefined) {
      const lists = await this.accessLists.normalize(chapterId, {
        who_can_see: whoCanSee,
        who_can_post: whoCanPost,
      });
      const nextSee =
        lists.who_can_see !== undefined
          ? lists.who_can_see
          : (existing.who_can_see ?? null);
      const nextPost =
        lists.who_can_post !== undefined
          ? lists.who_can_post
          : (existing.who_can_post ?? null);
      const followed = await this.categoryRepo.setAccess(
        chapterId,
        id,
        nextSee,
        nextPost,
      );
      for (const channelId of followed) this.channelCache.invalidate(channelId);
      updated = { ...updated, who_can_see: nextSee, who_can_post: nextPost };
    }
    return updated;
  }

  async deleteCategory(id: string, chapterId: string): Promise<void> {
    await this.getCategory(id, chapterId);
    await this.categoryRepo.delete(id, chapterId);
  }
}
