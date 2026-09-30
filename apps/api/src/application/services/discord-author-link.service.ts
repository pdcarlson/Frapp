import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  DISCORD_CONNECTION_REPOSITORY,
  type IDiscordConnectionRepository,
} from '#domain/repositories/discord-connection.repository.interface';
import {
  DISCORD_AUTHOR_LINK_REPOSITORY,
  DiscordAuthorLinkConflictError,
  DiscordAuthorLinkNotMemberError,
  type IDiscordAuthorLinkRepository,
} from '#domain/repositories/discord-author-link.repository.interface';
import { DiscordOAuthService, isUuid } from './discord-oauth.service';

export interface DiscordAuthorLinkView {
  available: boolean;
  linked: boolean;
  discord_username: string | null;
  linked_at: string | null;
}

/**
 * A member linking their own Discord account in a chapter, so the chapter's
 * imported Discord history they wrote is attributed to them (#2878).
 *
 * The owner's decisions this implements (2026-09-29, spec/behavior/chat/
 * README.md § Imported archive messages):
 *
 *  * **Self-claim only.** The member proves the account with Discord OAuth
 *    (`identify`). No officer route links anyone, because an officer mapping
 *    would put a member's name on words they may not have written.
 *  * **Linking rewrites `sender_id`** on the chapter's imported rows by that
 *    author, so every rule keyed on the sender (block masking, reports, reply
 *    quotes, own-message delete) applies to them with no second code path.
 *  * **Per chapter.** Every read and write here takes the chapter the request
 *    is scoped to; nothing is looked up across chapters.
 *
 * The handshake itself (state, callback, park) lives in `DiscordOAuthService`,
 * which owns the one registered callback URL both Discord flows share.
 */
@Injectable()
export class DiscordAuthorLinkService {
  private readonly logger = new Logger(DiscordAuthorLinkService.name);

  constructor(
    private readonly oauthService: DiscordOAuthService,
    @Inject(DISCORD_CONNECTION_REPOSITORY)
    private readonly connectionRepo: IDiscordConnectionRepository,
    @Inject(DISCORD_AUTHOR_LINK_REPOSITORY)
    private readonly linkRepo: IDiscordAuthorLinkRepository,
  ) {}

  async getMine(
    chapterId: string,
    userId: string,
  ): Promise<DiscordAuthorLinkView> {
    const [available, link] = await Promise.all([
      this.oauthService.isAvailable(),
      this.linkRepo.findByChapterAndUser(chapterId, userId),
    ]);
    return {
      available,
      linked: link !== null,
      discord_username: link?.discord_username ?? null,
      linked_at: link?.linked_at ?? null,
    };
  }

  begin(
    chapterId: string,
    userId: string,
  ): Promise<{ authorize_url: string; expires_at: string }> {
    return this.oauthService.beginAuthorLink(chapterId, userId);
  }

  /**
   * Bind what the callback parked, for the member who started it.
   *
   * The token alone is not the authority: it rode an unauthenticated redirect
   * to whichever browser completed Discord's screen. The consume matches only
   * a handshake this member started, in this chapter
   * (`consumeAuthorLinkConfirmToken`), so a token that reached somebody else's
   * browser links nothing for them, and a token presented in another chapter
   * links nothing there.
   */
  async confirm(
    chapterId: string,
    userId: string,
    handshake: string,
  ): Promise<DiscordAuthorLinkView & { messages_linked: number }> {
    if (!isUuid(handshake)) {
      throw new BadRequestException(
        'That Discord link is not valid. Connect Discord again.',
      );
    }

    const pending = await this.connectionRepo.consumeAuthorLinkConfirmToken(
      handshake,
      chapterId,
      userId,
      new Date(),
    );
    if (!pending?.pending_discord_user_id) {
      // One answer for expired, spent, never parked, another chapter and
      // another member: telling them apart would tell a caller holding a
      // stolen token which one it was.
      throw new BadRequestException(
        'That Discord link has expired or was started by someone else. Connect Discord again.',
      );
    }

    let linked;
    try {
      linked = await this.linkRepo.link(
        chapterId,
        userId,
        pending.pending_discord_user_id,
        pending.pending_discord_username,
      );
    } catch (error) {
      if (error instanceof DiscordAuthorLinkConflictError) {
        // Not an oracle worth closing: the caller just proved they control
        // this Discord account, so they are the one person entitled to know
        // it is already claimed here.
        throw new ConflictException(
          'That Discord account is already linked to another member of this chapter.',
        );
      }
      if (error instanceof DiscordAuthorLinkNotMemberError) {
        throw new ForbiddenException(
          'You are no longer a member of this chapter.',
        );
      }
      throw error;
    }

    this.logger.log(
      `Member ${userId} linked a Discord account in chapter ${chapterId}; ${linked.messages_linked} imported messages attributed.`,
    );
    return {
      available: true,
      linked: true,
      discord_username: linked.discord_username,
      linked_at: linked.linked_at,
      messages_linked: linked.messages_linked,
    };
  }

  async unlink(
    chapterId: string,
    userId: string,
  ): Promise<{ unlinked: boolean; messages_restored: number }> {
    const restored = await this.linkRepo.unlink(chapterId, userId);
    if (restored !== null) {
      this.logger.log(
        `Member ${userId} unlinked their Discord account in chapter ${chapterId}; ${restored} imported messages returned to their Discord name.`,
      );
    }
    return { unlinked: restored !== null, messages_restored: restored ?? 0 };
  }
}
