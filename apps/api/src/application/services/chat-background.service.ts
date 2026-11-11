import * as path from 'path';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CHAT_BACKGROUND_PHOTO,
  channelTakesBackground,
  fileExtension,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isChatBackgroundKey,
  isDirectChannel,
  type ChatBackgroundKey,
} from '@repo/validation';
import { assertSafeStoragePath } from '#domain/utils/storage-path';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import type { ChatChannel } from '#domain/entities/chat.entity';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { ChannelAccessService } from './channel-access.service';

const BRANDING_BUCKET = 'branding';
/**
 * A signed photo URL outlives the clients' 5-minute cache comfortably, and is
 * short enough that a withdrawn photo stops loading within the hour.
 */
const PHOTO_URL_TTL_SECONDS = 60 * 60;

/** Every chat background photo, chapter default or channel, sits directly in here. */
function photoFolder(chapterId: string): string {
  return `chapters/${chapterId}/chat-backgrounds`;
}

export interface ResolvedChatBackground {
  background: ChatBackgroundKey;
  source: 'channel' | 'chapter' | 'none';
  photo_url: string | null;
}

interface StoredBackground {
  key: string | null | undefined;
  photoPath: string | null | undefined;
  messageId: string | null | undefined;
}

/**
 * Chat backgrounds (#3973). A chapter has a default background, set by whoever
 * edits the chapter profile; a channel may override it, set by
 * `channels:manage`; a DM is always plain. Behavior:
 * `spec/behavior/chat/README.md` § Chat backgrounds.
 *
 * A photo is announced by a chat line from the person who set it, so members
 * can report it the way they report any message (tap-and-hold), with no new
 * report button. The photo is shown only while that line exists: an officer
 * removing the reported line withdraws the photo, and the background falls
 * back to the chapter default (or plain).
 */
@Injectable()
export class ChatBackgroundService {
  private readonly logger = new Logger(ChatBackgroundService.name);

  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepo: IChapterRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * The single entitlement hook for photo backgrounds. Photo upload is a
   * candidate "Frat Max" feature (#3973, Paul 2026-11-10), but no Max plan
   * exists yet, so every chapter may upload. When Max is defined, gate it here
   * (and mirror the gate on the clients' photo control); nothing else checks.
   */
  private assertPhotoBackgroundAllowed(chapterId: string): void {
    // Every chapter, for now. A gate reads the chapter's plan from here.
    void chapterId;
  }

  /** What a member who can read the channel sees behind its messages. */
  async getForChannel(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ResolvedChatBackground> {
    const channel = await this.channelAccess.assertChannelAccess(
      channelId,
      chapterId,
      userId,
    );
    return this.resolve(channel, chapterId);
  }

  /** The chapter default, for the settings screen that edits it. */
  async getChapterDefault(
    chapterId: string,
  ): Promise<{ background: ChatBackgroundKey; photo_url: string | null }> {
    const resolved = await this.resolveChapterDefault(chapterId);
    return { background: resolved.background, photo_url: resolved.photo_url };
  }

  async requestPhotoUploadUrl(
    chapterId: string,
    filename: string,
    contentType: string,
  ): Promise<{ signedUrl: string; storagePath: string }> {
    this.assertPhotoBackgroundAllowed(chapterId);
    const ext = filename.includes('.') ? fileExtension(filename) : 'jpg';
    if (!isAllowedUploadMime('image', contentType)) {
      throw new BadRequestException(
        'Invalid content type. Only images are allowed.',
      );
    }
    if (!isAllowedUploadExtension('image', ext)) {
      throw new BadRequestException(
        'Invalid file extension. Only image files are allowed.',
      );
    }
    // A fresh key per mint, as the chapter logo does (#2592): a signed upload
    // URL can't overwrite an object, and setting the background stays the only
    // step that changes what members see.
    const storagePath = `${photoFolder(chapterId)}/${crypto.randomUUID()}.${path.basename(ext)}`;
    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      BRANDING_BUCKET,
      storagePath,
      contentType,
    );
    return { signedUrl, storagePath };
  }

  async setChannelBackground(
    channelId: string,
    chapterId: string,
    actorUserId: string,
    background: ChatBackgroundKey | null,
    storagePath: string | undefined,
  ): Promise<ResolvedChatBackground> {
    const channel = await this.channelRepo.findById(channelId, chapterId);
    if (!channel) throw new NotFoundException('Channel not found');
    if (isDirectChannel(channel)) {
      throw new BadRequestException('A DM or group DM has no background');
    }
    // The audit log is system-write only (#3909), and an archived channel
    // takes no writes; neither gets a background or its announcing line.
    // The clients offer the picker by the same rule (`canSetChannelBackground`).
    if (!channelTakesBackground(channel)) {
      throw new BadRequestException("This channel can't have a background");
    }

    let updated: ChatChannel;
    if (background === CHAT_BACKGROUND_PHOTO) {
      const photoPath = await this.assertUploadedPhoto(chapterId, storagePath);
      // The announcing line is the actor's own post, so it needs the actor's
      // own right to post there (read-only, private, role-gated, alumni).
      await this.channelAccess.assertChannelAccess(
        channel.id,
        chapterId,
        actorUserId,
        'post',
      );
      const line = await this.announce(
        channel.id,
        actorUserId,
        "Set this channel's background to a photo.",
      );
      updated = await this.withdrawLineOnFailure(line, () =>
        this.channelRepo.update(channel.id, chapterId, {
          background: CHAT_BACKGROUND_PHOTO,
          background_photo_path: photoPath,
          background_message_id: line,
        }),
      );
    } else {
      updated = await this.channelRepo.update(channel.id, chapterId, {
        background: background ?? null,
        background_photo_path: null,
        background_message_id: null,
      });
    }
    return this.resolve(updated, chapterId);
  }

  async setChapterDefault(
    chapterId: string,
    actorUserId: string,
    background: ChatBackgroundKey,
    storagePath: string | undefined,
  ): Promise<{ background: ChatBackgroundKey; photo_url: string | null }> {
    if (background === CHAT_BACKGROUND_PHOTO) {
      const photoPath = await this.assertUploadedPhoto(chapterId, storagePath);
      const channel = await this.announcementChannel(chapterId);
      if (!channel) {
        throw new BadRequestException(
          'The chapter needs a default or #general channel to announce a photo background in',
        );
      }
      await this.channelAccess.assertChannelAccess(
        channel.id,
        chapterId,
        actorUserId,
        'post',
      );
      const line = await this.announce(
        channel.id,
        actorUserId,
        "Set the chapter's chat background to a photo.",
      );
      await this.withdrawLineOnFailure(line, () =>
        this.chapterRepo.update(chapterId, {
          chat_background: CHAT_BACKGROUND_PHOTO,
          chat_background_photo_path: photoPath,
          chat_background_message_id: line,
        }),
      );
    } else {
      await this.chapterRepo.update(chapterId, {
        chat_background: background,
        chat_background_photo_path: null,
        chat_background_message_id: null,
      });
    }
    return this.getChapterDefault(chapterId);
  }

  private async resolve(
    channel: ChatChannel,
    chapterId: string,
  ): Promise<ResolvedChatBackground> {
    if (isDirectChannel(channel)) {
      return { background: 'plain', source: 'none', photo_url: null };
    }
    if (channel.background) {
      const own = await this.resolveStored({
        key: channel.background,
        photoPath: channel.background_photo_path,
        messageId: channel.background_message_id,
      });
      // A withdrawn photo falls through to the chapter default.
      if (own) return { ...own, source: 'channel' };
    }
    return this.resolveChapterDefault(chapterId);
  }

  private async resolveChapterDefault(
    chapterId: string,
  ): Promise<ResolvedChatBackground> {
    const chapter = await this.chapterRepo.findById(chapterId);
    const stored = chapter
      ? await this.resolveStored({
          key: chapter.chat_background,
          photoPath: chapter.chat_background_photo_path,
          messageId: chapter.chat_background_message_id,
        })
      : null;
    return {
      ...(stored ?? { background: 'plain' as const, photo_url: null }),
      source: 'chapter',
    };
  }

  /**
   * A stored setting as members see it, or null when it is a photo that has
   * been withdrawn: its announcing line deleted, or never recorded.
   */
  private async resolveStored({
    key,
    photoPath,
    messageId,
  }: StoredBackground): Promise<Omit<ResolvedChatBackground, 'source'> | null> {
    if (!isChatBackgroundKey(key)) return null;
    if (key !== CHAT_BACKGROUND_PHOTO)
      return { background: key, photo_url: null };
    if (!photoPath) return null;
    // Withdrawn only by a removal of the line itself (a soft delete: the
    // sender's own, or an officer's on a report). A line that is gone because
    // its whole channel was deleted (the FK nulled the id) leaves the photo
    // standing; deleting #general shouldn't silently reset the chapter.
    if (messageId) {
      const line = await this.messageRepo.findById(messageId);
      if (line?.is_deleted) return null;
    }
    try {
      const url = await this.storageProvider.getSignedDownloadUrl(
        BRANDING_BUCKET,
        photoPath,
        PHOTO_URL_TTL_SECONDS,
      );
      return { background: key, photo_url: url };
    } catch (error) {
      // Decoration: a storage failure draws plain rather than failing the read.
      logThrowable(
        this.logger,
        'warn',
        `Could not sign chat background ${photoPath}`,
        error,
      );
      return { background: key, photo_url: null };
    }
  }

  /** The upload must exist, directly in this chapter's folder (as the logo's confirm checks). */
  private async assertUploadedPhoto(
    chapterId: string,
    storagePath: string | undefined,
  ): Promise<string> {
    this.assertPhotoBackgroundAllowed(chapterId);
    const folder = photoFolder(chapterId);
    if (!storagePath || !storagePath.startsWith(`${folder}/`)) {
      throw new BadRequestException(
        'storage_path must be a chat background upload for this chapter',
      );
    }
    try {
      assertSafeStoragePath(
        storagePath,
        'storage_path must not contain relative path segments',
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const stored = await this.storageProvider.listObjects(
      BRANDING_BUCKET,
      folder,
    );
    if (!stored.some((object) => object.path === storagePath)) {
      throw new BadRequestException(
        'storage_path does not reference an uploaded photo',
      );
    }
    return storagePath;
  }

  /**
   * Run the setting's write; if it fails, soft-delete the line already
   * posted, so a failed save doesn't leave "Set ... to a photo." behind (and
   * a retry doesn't post a second one). Best effort: the write's error wins.
   */
  private async withdrawLineOnFailure<T>(
    lineId: string,
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      await this.messageRepo
        .update(lineId, { is_deleted: true })
        .catch((cleanup: unknown) =>
          logThrowable(
            this.logger,
            'warn',
            `Could not withdraw chat background line ${lineId}`,
            cleanup,
          ),
        );
      throw error;
    }
  }

  /** Where a chapter-default photo is announced: the default channel, else #general. */
  private async announcementChannel(
    chapterId: string,
  ): Promise<ChatChannel | null> {
    const channels = (await this.channelRepo.findByChapter(chapterId)).filter(
      (c) => channelTakesBackground(c),
    );
    return (
      channels.find((c) => c.is_default) ??
      channels.find((c) => c.name === 'general') ??
      null
    );
  }

  /**
   * The reportable line. Authored by the person who set the photo, so a
   * report names them, and an ordinary text message, so every client renders
   * it and its tap-and-hold menu already offers Report.
   */
  private async announce(
    channelId: string,
    actorUserId: string,
    content: string,
  ): Promise<string> {
    const message = await this.messageRepo.create({
      channel_id: channelId,
      sender_id: actorUserId,
      content,
      type: 'TEXT',
      kind: 'text',
      reply_to_id: null,
      metadata: { chat_background: true },
    });
    return message.id;
  }
}
