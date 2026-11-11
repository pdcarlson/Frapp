import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ANNOUNCE_CHANNEL_FORBIDDEN,
  ChatBackgroundService,
  NO_ANNOUNCE_CHANNEL,
} from './chat-background.service';
import type { ChatChannel } from '#domain/entities/chat.entity';

const CHAPTER = 'chapter-1';
const FOLDER = `chapters/${CHAPTER}/chat-backgrounds`;
const PHOTO = `${FOLDER}/abc.jpg`;

function channel(over: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: 'ch-1',
    chapter_id: CHAPTER,
    name: 'general',
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    who_can_see: null,
    who_can_post: null,
    member_ids: null,
    category_id: null,
    is_read_only: false,
    created_at: '2026-11-10T00:00:00Z',
    archived_at: null,
    default_notification_level: null,
    is_default: false,
    is_audit_log: false,
    display_locked: false,
    created_by: null,
    background: null,
    background_photo_path: null,
    background_message_id: null,
    ...over,
  };
}

interface SetupOptions {
  chapter?: Record<string, unknown>;
  stored?: string[];
  line?: { id: string; is_deleted: boolean } | null;
  channels?: ChatChannel[];
}

function setup({
  chapter = { chat_background: 'plain' },
  stored = [PHOTO],
  line = { id: 'msg-1', is_deleted: false },
  channels = [channel()],
}: SetupOptions = {}) {
  const channelRepo = {
    findById: jest.fn(
      async (id: string) => channels.find((c) => c.id === id) ?? null,
    ),
    findByChapter: jest.fn(async () => channels),
    update: jest.fn(
      async (_id: string, _c: string, data: Partial<ChatChannel>) => ({
        ...channels[0],
        ...data,
      }),
    ),
  };
  const messageRepo = {
    findById: jest.fn(async () => line),
    create: jest.fn(async () => ({ id: 'msg-new' })),
    update: jest.fn(async () => ({})),
  };
  const chapterRepo = {
    findById: jest.fn(async () => ({ id: CHAPTER, ...chapter })),
    update: jest.fn(async () => ({})),
  };
  const storage = {
    getSignedUploadUrl: jest.fn(async () => 'https://upload'),
    getSignedDownloadUrl: jest.fn(async () => 'https://signed'),
    listObjects: jest.fn(async () => stored.map((p) => ({ path: p }))),
  };
  const access = {
    assertChannelAccess: jest.fn(async (id: string) =>
      channels.find((c) => c.id === id),
    ),
  };
  const service = new ChatBackgroundService(
    channelRepo as never,
    messageRepo as never,
    chapterRepo as never,
    storage as never,
    access as never,
  );
  return { service, channelRepo, messageRepo, chapterRepo, storage, access };
}

describe('ChatBackgroundService (#3973)', () => {
  describe('getForChannel', () => {
    it('follows the chapter default when the channel has no background of its own', async () => {
      const { service } = setup({ chapter: { chat_background: 'midnight' } });
      await expect(
        service.getForChannel('ch-1', CHAPTER, 'u'),
      ).resolves.toEqual({
        background: 'midnight',
        source: 'chapter',
        photo_url: null,
      });
    });

    it("uses the channel's own background over the default", async () => {
      const { service } = setup({
        chapter: { chat_background: 'midnight' },
        channels: [channel({ background: 'game-day' })],
      });
      await expect(
        service.getForChannel('ch-1', CHAPTER, 'u'),
      ).resolves.toMatchObject({
        background: 'game-day',
        source: 'channel',
      });
    });

    it('signs a photo while its announcing line exists', async () => {
      const { service } = setup({
        channels: [
          channel({
            background: 'photo',
            background_photo_path: PHOTO,
            background_message_id: 'msg-1',
          }),
        ],
      });
      await expect(
        service.getForChannel('ch-1', CHAPTER, 'u'),
      ).resolves.toEqual({
        background: 'photo',
        source: 'channel',
        photo_url: 'https://signed',
      });
    });

    it('withdraws a photo whose line was removed, falling back to the chapter default', async () => {
      const { service, storage } = setup({
        chapter: { chat_background: 'letters' },
        line: { id: 'msg-1', is_deleted: true },
        channels: [
          channel({
            background: 'photo',
            background_photo_path: PHOTO,
            background_message_id: 'msg-1',
          }),
        ],
      });
      await expect(
        service.getForChannel('ch-1', CHAPTER, 'u'),
      ).resolves.toEqual({
        background: 'letters',
        source: 'chapter',
        photo_url: null,
      });
      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('draws a DM plain, whatever the chapter default', async () => {
      const { service } = setup({
        chapter: { chat_background: 'midnight' },
        channels: [channel({ type: 'DM' })],
      });
      await expect(
        service.getForChannel('ch-1', CHAPTER, 'u'),
      ).resolves.toEqual({
        background: 'plain',
        source: 'none',
        photo_url: null,
      });
    });

    it('checks the caller can read the channel', async () => {
      const { service, access } = setup();
      await service.getForChannel('ch-1', CHAPTER, 'u');
      expect(access.assertChannelAccess).toHaveBeenCalledWith(
        'ch-1',
        CHAPTER,
        'u',
      );
    });
  });

  describe('setChannelBackground', () => {
    it('sets a photo only after it was uploaded, and announces it in the channel', async () => {
      const { service, channelRepo, messageRepo } = setup();
      await service.setChannelBackground(
        'ch-1',
        CHAPTER,
        'actor',
        'photo',
        PHOTO,
      );
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'ch-1',
          sender_id: 'actor',
          kind: 'text',
        }),
      );
      expect(channelRepo.update).toHaveBeenCalledWith('ch-1', CHAPTER, {
        background: 'photo',
        background_photo_path: PHOTO,
        background_message_id: 'msg-new',
      });
    });

    it.each([
      ['missing', undefined],
      ['another chapter', 'chapters/other/chat-backgrounds/abc.jpg'],
      ['a climbing path', `${FOLDER}/../branding/logo.png`],
      ['never uploaded', `${FOLDER}/nope.jpg`],
    ])('refuses a photo path that is %s', async (_label, storagePath) => {
      const { service, channelRepo, messageRepo } = setup();
      await expect(
        service.setChannelBackground(
          'ch-1',
          CHAPTER,
          'actor',
          'photo',
          storagePath,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageRepo.create).not.toHaveBeenCalled();
      expect(channelRepo.update).not.toHaveBeenCalled();
    });

    it('clears the photo columns when a built-in or null is set', async () => {
      const { service, channelRepo, messageRepo } = setup();
      await service.setChannelBackground(
        'ch-1',
        CHAPTER,
        'actor',
        null,
        undefined,
      );
      expect(channelRepo.update).toHaveBeenCalledWith('ch-1', CHAPTER, {
        background: null,
        background_photo_path: null,
        background_message_id: null,
      });
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('refuses a DM', async () => {
      const { service } = setup({ channels: [channel({ type: 'GROUP_DM' })] });
      await expect(
        service.setChannelBackground(
          'ch-1',
          CHAPTER,
          'actor',
          'midnight',
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('who and where a line may be posted (#3973 review)', () => {
    it.each([
      ['the audit log', { is_audit_log: true }],
      ['an archived channel', { archived_at: '2026-11-01T00:00:00Z' }],
    ])('refuses %s', async (_label, over) => {
      const { service, messageRepo, channelRepo } = setup({
        channels: [channel(over)],
      });
      await expect(
        service.setChannelBackground('ch-1', CHAPTER, 'actor', 'photo', PHOTO),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(messageRepo.create).not.toHaveBeenCalled();
      expect(channelRepo.update).not.toHaveBeenCalled();
    });

    it("checks the actor's own right to post before announcing", async () => {
      const { service, access, messageRepo } = setup();
      access.assertChannelAccess.mockRejectedValueOnce(new Error('forbidden'));
      await expect(
        service.setChannelBackground('ch-1', CHAPTER, 'actor', 'photo', PHOTO),
      ).rejects.toThrow('forbidden');
      expect(access.assertChannelAccess).toHaveBeenCalledWith(
        'ch-1',
        CHAPTER,
        'actor',
        'post',
      );
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('withdraws the posted line when saving the setting fails', async () => {
      const { service, channelRepo, messageRepo } = setup();
      channelRepo.update.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.setChannelBackground('ch-1', CHAPTER, 'actor', 'photo', PHOTO),
      ).rejects.toThrow('db down');
      expect(messageRepo.update).toHaveBeenCalledWith('msg-new', {
        is_deleted: true,
      });
    });

    it('keeps a photo whose line went with its deleted channel (the FK nulled the id)', async () => {
      const { service } = setup({
        chapter: {
          chat_background: 'photo',
          chat_background_photo_path: PHOTO,
          chat_background_message_id: null,
        },
      });
      await expect(service.getChapterDefault(CHAPTER)).resolves.toEqual({
        background: 'photo',
        photo_url: 'https://signed',
      });
    });

    it('announces a default photo in #general when no usable default channel exists', async () => {
      const { service, messageRepo } = setup({
        channels: [
          channel({
            id: 'audit',
            name: 'chapter-audit',
            is_audit_log: true,
            is_default: true,
          }),
          channel({
            id: 'old',
            name: 'old',
            is_default: true,
            archived_at: '2026-01-01T00:00:00Z',
          }),
          channel({ id: 'dm', name: 'general', type: 'DM' }),
          channel({ id: 'gen', name: 'general' }),
        ],
      });
      await service.setChapterDefault(CHAPTER, 'actor', 'photo', PHOTO);
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'gen' }),
      );
    });

    // #4262: a Discord-imported chapter keeps its Discord channel names, so it
    // can have no #general and no default; its photo default 400'd.
    it('announces in the oldest channel the setter can post in when there is no default or #general', async () => {
      const { service, access, messageRepo, chapterRepo } = setup({
        channels: [
          channel({
            id: 'rush',
            name: 'rush',
            created_at: '2026-10-02T00:00:00Z',
          }),
          channel({
            id: 'exec',
            name: 'exec',
            created_at: '2026-10-01T00:00:00Z',
          }),
          channel({
            id: 'house',
            name: 'house-chat',
            created_at: '2026-10-01T12:00:00Z',
          }),
        ],
      });
      // The oldest one is role-gated away from this setter.
      access.assertChannelAccess.mockImplementation(async (id: string) => {
        if (id === 'exec') {
          throw new ForbiddenException(
            'You do not have access to this channel',
          );
        }
        return undefined;
      });
      await service.setChapterDefault(CHAPTER, 'actor', 'photo', PHOTO);
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'house' }),
      );
      expect(chapterRepo.update).toHaveBeenCalledWith(
        CHAPTER,
        expect.objectContaining({ chat_background: 'photo' }),
      );
    });

    it('refuses a default photo only when the setter can post in no channel', async () => {
      const { service, access, chapterRepo, messageRepo } = setup({
        channels: [channel({ name: 'house' })],
      });
      access.assertChannelAccess.mockRejectedValue(
        new ForbiddenException('You do not have access to this channel'),
      );
      await expect(
        service.setChapterDefault(CHAPTER, 'actor', 'photo', PHOTO),
      ).rejects.toThrow(NO_ANNOUNCE_CHANNEL);
      expect(messageRepo.create).not.toHaveBeenCalled();
      expect(chapterRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('setChapterDefault', () => {
    it('announces a default photo in the default channel', async () => {
      const { service, messageRepo, chapterRepo } = setup({
        channels: [
          channel(),
          channel({ id: 'ch-2', name: 'house', is_default: true }),
        ],
      });
      await service.setChapterDefault(CHAPTER, 'actor', 'photo', PHOTO);
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ channel_id: 'ch-2' }),
      );
      expect(chapterRepo.update).toHaveBeenCalledWith(CHAPTER, {
        chat_background: 'photo',
        chat_background_photo_path: PHOTO,
        chat_background_message_id: 'msg-new',
      });
    });

    it('names the announcement channel when the setter cannot post there (#4262)', async () => {
      const { service, access, messageRepo } = setup();
      access.assertChannelAccess.mockRejectedValueOnce(
        new ForbiddenException('You do not have access to this channel'),
      );
      await expect(
        service.setChapterDefault(CHAPTER, 'actor', 'photo', PHOTO),
      ).rejects.toThrow(ANNOUNCE_CHANNEL_FORBIDDEN);
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('sets a built-in default without a line', async () => {
      const { service, messageRepo, chapterRepo } = setup();
      await service.setChapterDefault(CHAPTER, 'actor', 'gold-glow', undefined);
      expect(chapterRepo.update).toHaveBeenCalledWith(CHAPTER, {
        chat_background: 'gold-glow',
        chat_background_photo_path: null,
        chat_background_message_id: null,
      });
      expect(messageRepo.create).not.toHaveBeenCalled();
    });
  });

  it('refuses a non-image upload', async () => {
    const { service } = setup();
    await expect(
      service.requestPhotoUploadUrl(CHAPTER, 'x.svg', 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mints photo uploads into the chapter folder', async () => {
    const { service } = setup();
    const { storagePath } = await service.requestPhotoUploadUrl(
      CHAPTER,
      'a.jpg',
      'image/jpeg',
    );
    expect(storagePath).toMatch(new RegExp(`^${FOLDER}/[0-9a-f-]+\\.jpg$`));
  });
});
