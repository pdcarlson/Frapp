import { BadRequestException } from '@nestjs/common';
import { ChatBackgroundService } from './chat-background.service';
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
    member_ids: null,
    category_id: null,
    is_read_only: false,
    created_at: '2026-11-10T00:00:00Z',
    archived_at: null,
    default_notification_level: null,
    is_default: false,
    is_audit_log: false,
    background: null,
    background_photo_path: null,
    background_message_id: null,
    ...over,
  };
}

function setup({
  chapter = { chat_background: 'plain' },
  stored = [PHOTO],
  line = { id: 'msg-1', is_deleted: false },
  channels = [channel()],
} = {}) {
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
