import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isDirectChannel } from '@repo/validation';
import {
  CHAT_CATEGORY_REPOSITORY,
  CHAT_CHANNEL_REPOSITORY,
  type IChatCategoryRepository,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';

/**
 * The chapter's order for its channel list (owner, 2026-11-11): an officer
 * drags a channel within its section or into another category, or drags a
 * category's heading, in the web rail, and every member sees that order.
 * `spec/behavior/chat/README.md` § Sidebar arrangement owns the rule.
 *
 * Its own service, beside `ChatCategoryService`: it writes `chat_channels`
 * and `chat_channel_categories` together and nothing on the send path reads
 * it. The `channels:manage` gate is the controller's; the chapter scoping is
 * here, in every lookup and again in the RPCs.
 */
@Injectable()
export class ChatChannelOrderService {
  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
  ) {}

  /**
   * Files `channelIds` under `categoryId` (null: the default Channels section)
   * in that order. 404 when a channel or the category is not in this chapter,
   * so a UUID from another chapter reads as missing; 400 for a DM, a group DM
   * or `#chapter-audit`, which have no place in a category's order.
   */
  async reorderChannels(
    chapterId: string,
    categoryId: string | null,
    channelIds: string[],
  ): Promise<void> {
    const [channels, category] = await Promise.all([
      this.channelRepo.findByIds(chapterId, channelIds),
      categoryId
        ? this.categoryRepo.findById(categoryId, chapterId)
        : Promise.resolve(null),
    ]);
    if (categoryId && !category) {
      throw new NotFoundException('Category not found');
    }
    if (channels.length !== channelIds.length) {
      throw new NotFoundException('Channel not found');
    }
    if (
      channels.some(
        (channel) => isDirectChannel(channel) || channel.is_audit_log,
      )
    ) {
      throw new BadRequestException(
        'Direct messages and the audit log have no place in the channel order',
      );
    }
    await this.channelRepo.reorder(chapterId, categoryId, channelIds);
  }

  /** The chapter's category order. 404 when one is not in this chapter. */
  async reorderCategories(
    chapterId: string,
    categoryIds: string[],
  ): Promise<void> {
    const categories = await this.categoryRepo.findByChapter(chapterId);
    const known = new Set(categories.map((category) => category.id));
    if (categoryIds.some((id) => !known.has(id))) {
      throw new NotFoundException('Category not found');
    }
    await this.categoryRepo.reorder(chapterId, categoryIds);
  }
}
