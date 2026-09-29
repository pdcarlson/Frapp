import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  categoryIdFromSectionKey,
  isSidebarSectionKey,
} from '@repo/validation';
import {
  CHAT_SIDEBAR_REPOSITORY,
  type ChatSidebarFilters,
  type IChatSidebarRepository,
} from '#domain/repositories/chat-sidebar.repository.interface';
import {
  CHAT_CATEGORY_REPOSITORY,
  type IChatCategoryRepository,
} from '#domain/repositories/chat.repository.interface';
import { ChannelAccessService } from './channel-access.service';

/** What every `/v1/chat-sidebar` route answers with. */
export interface ChatSidebarView {
  unread_only: boolean;
  hide_muted: boolean;
  collapsed_sections: string[];
  pinned_channel_ids: string[];
}

/**
 * A member's own arrangement of the chat sidebar (#2877), per
 * `spec/behavior/chat/README.md` § Sidebar arrangement.
 *
 * **What the server decides, and what it leaves to the clients.** The server
 * stores the member's choices and answers who may pin what. It does not arrange
 * the list: grouping, pinning, filtering and sorting run in one shared function
 * in `@repo/hooks` over data both clients already hold (channels, categories,
 * unread counts, notification levels), and the unread and muted inputs to it
 * are still the server's own numbers.
 *
 * **A separate service from `ChatService`**, for the reason `ChatBookmarkService`
 * gives: it shares nothing with the chat hot path but the authorization seam,
 * `ChannelAccessService`, and #1380 is open to split `ChatService` rather than
 * grow it.
 *
 * No route or method takes a user id from the caller; the owner is always the
 * authenticated member, so nobody, an officer included, can read or change
 * another member's arrangement.
 */
@Injectable()
export class ChatSidebarService {
  constructor(
    @Inject(CHAT_SIDEBAR_REPOSITORY)
    private readonly sidebarRepo: IChatSidebarRepository,
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * The member's arrangement, with every default filled in.
   *
   * Pins are narrowed to channels the member can still read. A pin outlives
   * losing access (leaving a private channel removes nobody's pin), so serving
   * stored rows would hand back ids of channels the member can no longer see,
   * the same leak `getChannelNotificationPreferences` closes by driving its
   * answer off the accessible list. An archived Group DM drops out here too,
   * as it drops out of `GET /v1/channels`.
   */
  async getSidebar(
    chapterId: string,
    userId: string,
  ): Promise<ChatSidebarView> {
    const [preferences, pinnedIds] = await Promise.all([
      this.sidebarRepo.findPreferences(chapterId, userId),
      this.sidebarRepo.findPinnedChannelIds(chapterId, userId),
    ]);
    const readable = await this.channelAccess.filterAccessibleChannelIds(
      chapterId,
      userId,
      pinnedIds,
    );
    return {
      unread_only: preferences?.unread_only ?? false,
      hide_muted: preferences?.hide_muted ?? false,
      collapsed_sections: preferences?.collapsed_sections ?? [],
      pinned_channel_ids: pinnedIds.filter((id) => readable.has(id)),
    };
  }

  /**
   * Switch one or both filters. An empty body is refused rather than treated as
   * a no-op, since it can only be a client bug: every control sends the one
   * filter it switched.
   */
  async updateFilters(
    chapterId: string,
    userId: string,
    filters: ChatSidebarFilters,
  ): Promise<ChatSidebarView> {
    const given: ChatSidebarFilters = {};
    if (filters.unread_only !== undefined) {
      given.unread_only = filters.unread_only;
    }
    if (filters.hide_muted !== undefined) {
      given.hide_muted = filters.hide_muted;
    }
    if (Object.keys(given).length === 0) {
      throw new BadRequestException('Send unread_only, hide_muted, or both.');
    }
    await this.sidebarRepo.updateFilters(chapterId, userId, given);
    return this.getSidebar(chapterId, userId);
  }

  /**
   * Fold or unfold one section.
   *
   * A malformed key is refused (400), and a `category:` key must name a
   * category in the member's own chapter (404 otherwise). That bounds the
   * stored array by the chapter's categories, so a scripted client cannot grow
   * it without limit, and keeps a category id from another chapter out of it.
   * Unfolding skips the category check: removing a key only ever shrinks the
   * array, and a member must be able to clear a key whose category was deleted.
   */
  async setSectionCollapsed(
    chapterId: string,
    userId: string,
    sectionKey: string,
    collapsed: boolean,
  ): Promise<ChatSidebarView> {
    if (!isSidebarSectionKey(sectionKey)) {
      throw new BadRequestException(
        'Unknown sidebar section. Use pinned, channels, direct, system, or category:<id>.',
      );
    }
    const categoryId = categoryIdFromSectionKey(sectionKey);
    if (collapsed && categoryId !== null) {
      const category = await this.categoryRepo.findById(categoryId, chapterId);
      if (!category) throw new NotFoundException('Category not found');
    }
    await this.sidebarRepo.setSectionCollapsed(
      chapterId,
      userId,
      sectionKey,
      collapsed,
    );
    return this.getSidebar(chapterId, userId);
  }

  /**
   * Pin a channel. The member must be able to read it: `assertChannelAccess`
   * answers 404 for a channel outside the chapter and 403 for one they can't
   * read, the same as opening it would. That authorization is also what makes
   * the stored `chapter_id` true, since the channel was found under it.
   */
  async pin(
    chapterId: string,
    userId: string,
    channelId: string,
  ): Promise<ChatSidebarView> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);
    await this.sidebarRepo.pin(chapterId, userId, channelId);
    return this.getSidebar(chapterId, userId);
  }

  /**
   * Unpin a channel. No access check: removing the member's own row reveals
   * nothing, and a member who lost access to a channel must still be able to
   * clear its pin.
   */
  async unpin(
    chapterId: string,
    userId: string,
    channelId: string,
  ): Promise<ChatSidebarView> {
    await this.sidebarRepo.unpin(chapterId, userId, channelId);
    return this.getSidebar(chapterId, userId);
  }
}
