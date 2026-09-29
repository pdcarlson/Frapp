import { Test } from '@nestjs/testing';
import { DiscordAuthorLinkService } from './discord-author-link.service';
import { DiscordOAuthService } from './discord-oauth.service';
import { DISCORD_CONNECTION_REPOSITORY } from '#domain/repositories/discord-connection.repository.interface';
import {
  DISCORD_AUTHOR_LINK_REPOSITORY,
  DiscordAuthorLinkConflictError,
  DiscordAuthorLinkNotMemberError,
} from '#domain/repositories/discord-author-link.repository.interface';
import type { DiscordOAuthState } from '#domain/entities/discord-connection.entity';

const CHAPTER = 'chapter-1';
const USER = 'user-1';
const TOKEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISCORD_ID = '3000000000000000003';

function parked(overrides: Partial<DiscordOAuthState> = {}): DiscordOAuthState {
  return {
    id: 'state-1',
    chapter_id: CHAPTER,
    purpose: 'author_link',
    created_by: USER,
    return_path: '/profile',
    expires_at: '2026-09-29T12:15:00Z',
    consumed_at: '2026-09-29T12:01:00Z',
    created_at: '2026-09-29T12:00:00Z',
    pending_guild_id: null,
    pending_guild_name: null,
    pending_guild_icon: null,
    pending_discord_user_id: DISCORD_ID,
    pending_discord_username: 'jkslayer',
    pending_permissions: null,
    pending_scopes: 'identify',
    confirm_token: TOKEN,
    confirm_expires_at: '2026-09-29T12:06:00Z',
    confirmed_at: null,
    ...overrides,
  };
}

describe('DiscordAuthorLinkService (#2878)', () => {
  let service: DiscordAuthorLinkService;
  let oauth: { isAvailable: jest.Mock; beginAuthorLink: jest.Mock };
  let connections: { consumeAuthorLinkConfirmToken: jest.Mock };
  let links: {
    findByChapterAndUser: jest.Mock;
    listByChapter: jest.Mock;
    link: jest.Mock;
    unlink: jest.Mock;
  };

  beforeEach(async () => {
    oauth = {
      isAvailable: jest.fn(async () => true),
      beginAuthorLink: jest.fn(async () => ({
        authorize_url: 'https://discord.com/oauth2/authorize?x',
        expires_at: '2026-09-29T12:15:00Z',
      })),
    };
    connections = {
      consumeAuthorLinkConfirmToken: jest.fn(async () => parked()),
    };
    links = {
      findByChapterAndUser: jest.fn(async () => null),
      listByChapter: jest.fn(async () => []),
      link: jest.fn(async () => ({
        discord_user_id: DISCORD_ID,
        discord_username: 'jkslayer',
        linked_at: '2026-09-29T12:02:00Z',
        messages_linked: 412,
      })),
      unlink: jest.fn(async () => 412),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DiscordAuthorLinkService,
        { provide: DiscordOAuthService, useValue: oauth },
        { provide: DISCORD_CONNECTION_REPOSITORY, useValue: connections },
        { provide: DISCORD_AUTHOR_LINK_REPOSITORY, useValue: links },
      ],
    }).compile();
    service = moduleRef.get(DiscordAuthorLinkService);
  });

  describe('confirm', () => {
    it('links the parked account for the caller, in the caller chapter', async () => {
      const result = await service.confirm(CHAPTER, USER, TOKEN);

      expect(connections.consumeAuthorLinkConfirmToken).toHaveBeenCalledWith(
        TOKEN,
        CHAPTER,
        USER,
        expect.any(Date),
      );
      expect(links.link).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        DISCORD_ID,
        'jkslayer',
      );
      expect(result).toEqual({
        available: true,
        linked: true,
        discord_username: 'jkslayer',
        linked_at: '2026-09-29T12:02:00Z',
        messages_linked: 412,
      });
    });

    it('links nothing when the token was started by someone else, elsewhere, or is spent', async () => {
      // The repository matches on token + purpose + chapter + created_by, so
      // every one of those failures reads as no row. That is the whole
      // confused-deputy control: whoever's browser holds the token, only the
      // member who started the handshake can spend it.
      connections.consumeAuthorLinkConfirmToken.mockResolvedValue(null);

      await expect(
        service.confirm(CHAPTER, 'someone-else', TOKEN),
      ).rejects.toMatchObject({
        status: 400,
      });
      expect(links.link).not.toHaveBeenCalled();
    });

    it('refuses a malformed token without touching the store', async () => {
      await expect(
        service.confirm(CHAPTER, USER, 'nope'),
      ).rejects.toMatchObject({
        status: 400,
      });
      expect(connections.consumeAuthorLinkConfirmToken).not.toHaveBeenCalled();
    });

    it('never links a handshake that parked no account', async () => {
      connections.consumeAuthorLinkConfirmToken.mockResolvedValue(
        parked({ pending_discord_user_id: null }),
      );
      await expect(service.confirm(CHAPTER, USER, TOKEN)).rejects.toMatchObject(
        {
          status: 400,
        },
      );
      expect(links.link).not.toHaveBeenCalled();
    });

    it('answers 409 when another member of the chapter holds the account', async () => {
      links.link.mockRejectedValue(new DiscordAuthorLinkConflictError());
      await expect(service.confirm(CHAPTER, USER, TOKEN)).rejects.toMatchObject(
        {
          status: 409,
        },
      );
    });

    it('answers 403 when the caller left the chapter mid-flow', async () => {
      links.link.mockRejectedValue(new DiscordAuthorLinkNotMemberError());
      await expect(service.confirm(CHAPTER, USER, TOKEN)).rejects.toMatchObject(
        {
          status: 403,
        },
      );
    });

    it('rethrows anything else', async () => {
      const boom = { code: 'XX000', message: 'boom' };
      links.link.mockRejectedValue(boom);
      await expect(service.confirm(CHAPTER, USER, TOKEN)).rejects.toBe(boom);
    });
  });

  describe('getMine', () => {
    it('reports no link, with availability', async () => {
      oauth.isAvailable.mockResolvedValue(false);
      await expect(service.getMine(CHAPTER, USER)).resolves.toEqual({
        available: false,
        linked: false,
        discord_username: null,
        linked_at: null,
      });
      expect(links.findByChapterAndUser).toHaveBeenCalledWith(CHAPTER, USER);
    });

    it('reports the caller link', async () => {
      links.findByChapterAndUser.mockResolvedValue({
        id: 'l1',
        chapter_id: CHAPTER,
        user_id: USER,
        discord_user_id: DISCORD_ID,
        discord_username: 'jkslayer',
        linked_at: '2026-09-29T12:02:00Z',
      });
      await expect(service.getMine(CHAPTER, USER)).resolves.toMatchObject({
        linked: true,
        discord_username: 'jkslayer',
      });
    });
  });

  describe('unlink', () => {
    it('returns how many messages went back to the Discord name', async () => {
      await expect(service.unlink(CHAPTER, USER)).resolves.toEqual({
        unlinked: true,
        messages_restored: 412,
      });
      expect(links.unlink).toHaveBeenCalledWith(CHAPTER, USER);
    });

    it('reports false when there was no link', async () => {
      links.unlink.mockResolvedValue(null);
      await expect(service.unlink(CHAPTER, USER)).resolves.toEqual({
        unlinked: false,
        messages_restored: 0,
      });
    });
  });

  it('begin delegates to the OAuth handshake for the caller and chapter', async () => {
    await service.begin(CHAPTER, USER);
    expect(oauth.beginAuthorLink).toHaveBeenCalledWith(CHAPTER, USER);
  });

  it('listLinks reads only the caller chapter', async () => {
    await service.listLinks(CHAPTER);
    expect(links.listByChapter).toHaveBeenCalledWith(CHAPTER);
  });
});
