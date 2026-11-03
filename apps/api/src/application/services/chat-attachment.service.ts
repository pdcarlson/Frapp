import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_UPLOAD_LABEL,
} from '@repo/validation';
import {
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  type IChatMessageAttachmentRepository,
  type IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type {
  HeldObject,
  IChatMessageReportRepository,
  ReportEvidence,
  StoredObjectRef,
} from '#domain/repositories/chat-moderation.repository.interface';
import type {
  ReportedAttachment,
  ReportedAttachmentWithUrl,
} from '#domain/entities/chat-moderation.entity';
import type {
  ChatMessageAttachment,
  ChatMessageAttachmentWithUrl,
} from '#domain/entities/chat.entity';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import {
  CHAT_ARCHIVE_BUCKET,
  safeObjectFilename,
} from '#domain/constants/storage';
import { isUnsafeStoragePath } from '#domain/utils/storage-path';
import { ChannelAccessService } from './channel-access.service';
import { ChatBlockService } from './chat-block.service';
import { isFromBlockedSender } from './chat-block-mask';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

const CHAT_BUCKET = 'chat';

/**
 * Upper bound on attachments per message.
 *
 * Not a product rule anybody asked for — a bound so a single send cannot fan out
 * into an unbounded insert and an unbounded number of signed-URL mints on read.
 * Ten is well above what the composer's one-file-at-a-time picker produces.
 */
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Signed-download-URL lifetime for an attachment, in seconds.
 *
 * One hour, matching the report-export links — long enough that a link survives
 * reading a channel, short enough that a URL copied out of devtools is not a
 * durable handle on private chapter data.
 */
const ATTACHMENT_URL_TTL_SECONDS = 3600;

/** Signed-download-URL lifetime for an imported author's avatar, in seconds. */
const AUTHOR_AVATAR_URL_TTL_SECONDS = 3600;

/**
 * One attachment as the client claims it after uploading to the signed URL.
 *
 * The client is trusted for the metadata and NOT for the location: the service
 * re-derives `channel_id` from the message and re-checks `storage_path` against
 * the prefix it minted, so a caller cannot attach an object belonging to another
 * chapter, another channel, or another bucket.
 */
export interface SendMessageAttachmentInput {
  storage_path: string;
  filename: string;
  content_type: string;
  byte_size?: number | null;
}

/**
 * Chat's Storage objects, from the upload mint to the purge: a message's
 * attachments, an imported author's avatar, and the attachments a report holds
 * as evidence (#2481).
 *
 * Split out of `ChatService` (#1380). Everything that reads or writes the
 * `chat` and `chat-archive` buckets lives here, so the trust-boundary rules
 * for those bytes (the minted prefix, the forced download, the reference and
 * hold checks before a delete) sit in one class. `ChatService.sendMessage`
 * still decides when attachments are validated and written; this decides how.
 */
@Injectable()
export class ChatAttachmentService {
  private readonly logger = new Logger(ChatAttachmentService.name);

  constructor(
    @Inject(CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepo: IChatMessageAttachmentRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    // A report holds the reported message's attachments until it is released
    // (#2481): the delete purge asks which objects to leave, and the release
    // asks again.
    @Inject(CHAT_MESSAGE_REPORT_REPOSITORY)
    private readonly reportRepo: IChatMessageReportRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly chatBlocks: ChatBlockService,
  ) {}

  // ── Upload and send ──────────────────────────────────────────────────

  async requestChatUploadUrl(
    channelId: string,
    chapterId: string,
    userId: string,
    filename: string,
    contentType: string,
    sizeBytes?: number,
  ) {
    // Authorized as a "post", for the same reason `editMessage` is: a signed
    // URL lets the caller put bytes under this channel's storage prefix, so it
    // must clear the gates that decide who may write here — the read-only /
    // `announcements:post` gate, the Alumni lifecycle rule, and the
    // archived-channel freeze. Issuing a *write* credential on a *read* check
    // is the general form of the bug (#2186); the rule is that every step of a
    // two-step write authorizes as the write, never as the read that precedes
    // it. The mint is the first step and `sendMessage` is the second, so the
    // two must agree — `chat.service.spec.ts` § "mint and send agree" is the
    // test that keeps them agreeing.
    await this.channelAccess.assertChannelAccess(
      channelId,
      chapterId,
      userId,
      'post',
    );

    const ext = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!isAllowedUploadExtension('document', ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!isAllowedUploadMime('document', contentType)) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed`,
      );
    }

    if (sizeBytes !== undefined && !isWithinUploadSizeLimit(sizeBytes)) {
      throw new BadRequestException(
        `File exceeds the ${MAX_UPLOAD_LABEL} upload limit`,
      );
    }

    const messageId = crypto.randomUUID();
    const storagePath = `chapters/${chapterId}/chat/${channelId}/${messageId}/${safeObjectFilename(filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      CHAT_BUCKET,
      storagePath,
      contentType,
    );

    return { signedUrl, storagePath, messageId };
  }

  /**
   * Checks the attachments a client claims for a message it is sending.
   *
   * The client picked the filename and the content type and uploaded the bytes
   * through a signed URL, so those it is trusted for. The *location* it is not:
   * without this check a caller could send a message claiming any object in the
   * `chat` bucket — including one from another chapter's channel — and the API
   * would happily mint them a signed download URL for it later.
   *
   * The prefix checked here is exactly the one `requestChatUploadUrl` mints, which is
   * why the two are worth reading together.
   */
  validateAttachmentInputs(
    attachments: SendMessageAttachmentInput[],
    chapterId: string,
    channelId: string,
  ): SendMessageAttachmentInput[] {
    if (attachments.length === 0) return [];
    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(
        `A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`,
      );
    }

    const prefix = `chapters/${chapterId}/chat/${channelId}/`;
    const seen = new Set<string>();

    for (const attachment of attachments) {
      const storagePath = attachment.storage_path;
      if (!storagePath.startsWith(prefix)) {
        // Deliberately does not echo the offending path back — it is
        // attacker-supplied and the caller already knows what it sent.
        throw new BadRequestException(
          'Attachment does not belong to this channel',
        );
      }
      // The same segment rule the mint's `assertSafeObjectPath` applies, so a
      // key it signed is a key this accepts: `Notes..final.png` is a filename,
      // while a `..` (or `%2e%2e`) segment is a key nothing here minted (#3059).
      if (isUnsafeStoragePath(storagePath)) {
        throw new BadRequestException('Invalid attachment path');
      }
      if (seen.has(storagePath)) {
        throw new BadRequestException('Duplicate attachment');
      }
      seen.add(storagePath);

      if (!isAllowedUploadMime('document', attachment.content_type)) {
        throw new BadRequestException(
          `Content type "${attachment.content_type}" is not allowed`,
        );
      }
      if (
        attachment.byte_size != null &&
        (!Number.isFinite(attachment.byte_size) || attachment.byte_size < 0)
      ) {
        throw new BadRequestException('Invalid attachment size');
      }
    }

    return attachments;
  }

  /**
   * Writes the attachment rows for a message, and keeps `attachment_count`
   * honest if it cannot.
   *
   * This runs AFTER the message row, because `message_id` is a foreign key —
   * which means the message is already committed by the time this can fail.
   * There is no transaction spanning the two: the repositories are separate
   * PostgREST calls.
   *
   * So a bare `await` leaves the worst of both worlds on failure: the caller
   * gets a 500, and a message persists claiming `attachment_count: N` with no
   * rows behind it, which every reader renders forever as "attachment couldn't
   * be loaded". Clearing the count first degrades it to an ordinary message — a
   * truthful row — before the error surfaces.
   *
   * The error still surfaces. An attachment the sender watched upload and which
   * never became a row is exactly the silent data loss this change exists to
   * remove, so the send reports failure and the composer keeps its chips.
   */
  async persistAttachments(
    messageId: string,
    channelId: string,
    attachments: SendMessageAttachmentInput[],
  ): Promise<void> {
    if (attachments.length === 0) return;

    try {
      await this.attachmentRepo.createMany(
        attachments.map((attachment) => ({
          message_id: messageId,
          channel_id: channelId,
          bucket: CHAT_BUCKET,
          storage_path: attachment.storage_path,
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size ?? null,
        })),
      );
    } catch (error) {
      try {
        const message = await this.messageRepo.findById(messageId);
        const metadata = { ...(message?.metadata ?? {}) };
        delete metadata.attachment_count;
        await this.messageRepo.update(messageId, { metadata });
      } catch (cleanupError) {
        // Best effort. If even this fails the message keeps a count it cannot
        // satisfy, so say so loudly rather than losing it inside the original
        // error the caller is about to see.
        logThrowable(
          this.logger,
          'error',
          `Failed to clear attachment_count on message ${messageId} (channel ${channelId}) after a failed attachment write`,
          cleanupError,
        );
      }
      throw error;
    }
  }

  /**
   * The attachments on one message, each with a short-lived signed download URL.
   *
   * Separate from the message read rather than embedded in it, for two reasons
   * that point the same way. A download URL expires, so it has to be minted at
   * the moment it is going to be used rather than baked into a cached message
   * list — and the message cache on both clients is fed partly by Realtime rows,
   * which cannot carry a join at all. `metadata.attachment_count` is what tells a
   * client to call this.
   *
   * Access is the ordinary channel check, so a message in a channel the caller
   * cannot read answers 403/404 exactly as its own read does.
   *
   * **This route is the only way to a chat file**, and the block mask depends on
   * that. The `chat` bucket is private with no `storage.objects` policy, and
   * `chat_message_attachments` has RLS on with no policy, so a client cannot list
   * or fetch an attachment except through a URL minted here.
   * `chat-read-surface-ledger.spec.ts` fails on any migration that would open
   * another way: a policy on the table, RLS off on it, a storage policy that
   * could reach the bucket, or the bucket made public.
   */
  async listMessageAttachments(
    channelId: string,
    chapterId: string,
    userId: string,
    messageId: string,
  ): Promise<ChatMessageAttachmentWithUrl[]> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);

    const [message, blockedUserIds] = await Promise.all([
      this.messageRepo.findById(messageId),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    if (!message || message.channel_id !== channelId) {
      throw new NotFoundException('Message not found');
    }
    // A deleted message does not hand out its files. Deletion is soft, so the
    // `ON DELETE CASCADE` never fires and the rows are still there — without
    // this check the API keeps minting fresh download URLs for content the
    // sender believes they removed, and the rule would live only in the web
    // renderer, which is not where a rule about who may fetch bytes belongs.
    //
    // A message from a member the caller has blocked answers the same way
    // (#2324). The masked row drops `metadata.attachment_count`, but it keeps
    // its `id`, so the tombstone alone does not stop a client asking for the
    // files. It is the same 404 as a deleted message, not a distinct one. The
    // caller is the blocker, so nothing here tells the blocked member anything.
    // A block list that cannot be read has already thrown above: files are
    // withheld rather than served unchecked.
    if (
      message.is_deleted ||
      isFromBlockedSender(message.sender_id, new Set(blockedUserIds))
    ) {
      throw new NotFoundException('Message not found');
    }

    const rows = await this.attachmentRepo.findByMessage(messageId, chapterId);
    if (rows.length === 0) return [];

    const urls = await this.signChatObjects(rows, { messageId, channelId });
    return rows.flatMap((row) => {
      const downloadUrl = urls.get(objectKey(row));
      return downloadUrl ? [{ ...row, download_url: downloadUrl }] : [];
    });
  }

  /**
   * Forced-download signed URLs for chat objects, keyed by {@link objectKey}:
   * the one signing path for a message's attachments
   * ({@link listMessageAttachments}) and a report's held evidence
   * ({@link signReportEvidence}), so the trust-boundary choice below cannot
   * drift between them. An object that could not be signed is left out of the
   * map and logged; the caller omits it.
   *
   * Batched per bucket (#1231) rather than one `getSignedDownloadUrl` call
   * per row — `MAX_ATTACHMENTS_PER_MESSAGE` caps this at 10, so it was never
   * urgent, but a signed URL is still one provider round trip whether it
   * signs one path or ten. Every attachment on a message shares a bucket in
   * every case observed today; grouping defensively costs nothing and stays
   * correct if that ever changes.
   *
   * `forceDownload: true` on every call: `spec/behavior/chat/README.md`'s
   * "trust boundary" section is explicit that a signed upload URL cannot
   * pin a content type, so a member can store HTML declared as `image/png`
   * — forcing `Content-Disposition: attachment` (not the declared MIME
   * type) is what keeps that from rendering as HTML if a reader opens a
   * non-previewable attachment's URL directly (`target="_blank"`).
   * Dropping this is a security regression, not a UX one; see
   * `IStorageProvider.getSignedDownloadUrls`'s doc comment. The saved
   * filename can no longer be forced *per path* (the batch API takes one
   * `download` option for the whole call), so web additionally sets an
   * `<a download>` attribute for the display name (`message-attachments.
   * tsx`) — best-effort UX on top of the still-enforced disposition.
   */
  private async signChatObjects(
    objects: readonly StoredObjectRef[],
    context: Record<string, unknown>,
  ): Promise<Map<string, string>> {
    const pathsByBucket = new Map<string, string[]>();
    for (const { bucket, storage_path } of uniqueObjects(objects)) {
      const paths = pathsByBucket.get(bucket) ?? [];
      paths.push(storage_path);
      pathsByBucket.set(bucket, paths);
    }

    const urls = new Map<string, string>();
    await Promise.all(
      Array.from(pathsByBucket.entries()).map(async ([bucket, paths]) => {
        let signed: Record<string, string>;
        try {
          signed = await this.storageProvider.getSignedDownloadUrls(
            bucket,
            paths,
            ATTACHMENT_URL_TTL_SECONDS,
            true,
          );
        } catch (error) {
          // A whole-bucket failure must not take every other bucket's objects
          // down with it, the same guarantee `allSettled` gave a single dead
          // row before signing was batched.
          logThrowable(
            this.logger,
            'warn',
            `Could not sign a batch of chat attachments ${JSON.stringify({ ...context, bucket })}; omitting them`,
            error,
          );
          return;
        }
        for (const storagePath of paths) {
          const url = signed[storagePath];
          if (url) {
            urls.set(objectKey({ bucket, storage_path: storagePath }), url);
          } else {
            // Only per object for a path missing from an otherwise signed
            // bucket: a whole-bucket failure already logged once above with
            // the real error.
            this.logger.warn('Could not sign a chat attachment; omitting it', {
              ...context,
              storagePath,
            });
          }
        }
      }),
    );
    return urls;
  }

  /**
   * Signs `chat-archive` avatar paths for imported authors, batched into as
   * few provider calls as `getSignedDownloadUrls` allows (#1231).
   * The web timeline draws these for imported rows with no `sender_id`; a
   * row whose author linked their Discord account (#2878) is the member's
   * message and draws the member instead. Mobile does not call this yet
   * (#2886).
   *
   * Channel-scoped, like `listMessageAttachments` — and deliberately never a
   * function of a caller-supplied path at all. `author_avatar_path` and an
   * attachment's `storage_path` are written under the exact same
   * `chapters/{chapterId}/chat-archive/imports/{importId}/media/...` layout
   * (`archiveMediaObjectPath` — there is no `authors/`-vs-`attachments/`
   * split in the path shape), and this bucket carries no storage RLS (its
   * migration's own header: reads are API-issued signed URLs, which never
   * consult RLS). A raw path handed back by the caller would be
   * structurally indistinguishable from another message's attachment path,
   * so trusting one here would let a caller who knows — or guesses — an
   * attachment path get a signed URL for it under the guise of "avatar",
   * bypassing `assertChannelAccess` entirely.
   *
   * Instead the path set is derived server-side from `messageIds` via
   * `findAuthorAvatarPaths`, which scopes the lookup by `channelId` in the
   * same query — a message id from another channel contributes nothing,
   * the same pattern `findByMessage` uses to scope attachments by chapter.
   * `assertChannelAccess` above that is what makes `channelId` itself
   * trustworthy.
   *
   * Does NOT force a download (`getSignedDownloadUrls`' 4th argument stays
   * default `false`), unlike `listMessageAttachments`. An avatar only ever
   * renders behind an `<img src>` (never a clickable link a reader could
   * navigate to directly), and `<img>` never executes a response as HTML or
   * script regardless of `Content-Disposition` — so the mislabeled-MIME
   * mitigation that mandates it for attachments does not apply here, and
   * forcing it would just break inline rendering.
   */
  async resolveAuthorAvatars(
    channelId: string,
    chapterId: string,
    userId: string,
    messageIds: string[],
  ): Promise<Record<string, string>> {
    await this.channelAccess.assertChannelAccess(channelId, chapterId, userId);

    const paths = await this.messageRepo.findAuthorAvatarPaths(
      channelId,
      messageIds,
    );
    if (paths.length === 0) return {};

    try {
      return await this.storageProvider.getSignedDownloadUrls(
        CHAT_ARCHIVE_BUCKET,
        paths,
        AUTHOR_AVATAR_URL_TTL_SECONDS,
      );
    } catch (error) {
      // A whole-batch failure must not 500 the request — every message just
      // degrades to its initials fallback, same as an avatar that was never
      // requested.
      logThrowable(
        this.logger,
        'warn',
        `Could not sign a batch of author avatars for channel ${channelId} in chapter ${chapterId}; omitting them`,
        error,
      );
      return {};
    }
  }

  // ── Purge ─────────────────────────────────────────────────────────────

  /**
   * Delete the Storage objects belonging to a just-deleted message, skipping
   * any an undeleted message still references or a report holds as evidence
   * (#2481). A held object is released when its report resolves
   * ({@link releaseReportEvidence}).
   *
   * Owns its own read so that every failure on this path — the attachment
   * lookup, the reference probe, or Storage itself — is swallowed. Before this,
   * a transient PostgREST error on the lookup turned a delete that used to be a
   * single row update into a 500 with the message still visible.
   *
   * The reference guard is not defensive programming. `chat_message_attachments`
   * is unique on `(message_id, bucket, storage_path)` — per message — so two
   * messages may legitimately point at one object: the Discord importer maps
   * every reference to a deduplicated export file onto the same object, and
   * `validateAttachmentInputs` checks only the channel prefix, so a client can
   * claim a path another message already uses (#1622). Without the check,
   * deleting either message would delete the other's bytes.
   *
   * Grouped per bucket because imported media lives in `chat-archive` while
   * uploads live in `chat`, and each bucket is attempted independently: one
   * bucket's outage must not strand the other's objects.
   *
   * Two callers. `ChatService` runs it right after a soft delete lands, and
   * `ChatReportService` runs it to finish a reported message's removal whose
   * soft delete committed but whose answer was lost, so the purge after the
   * tombstone never ran. A no-op for objects already gone or still referenced
   * by another message.
   *
   * Callers confirm the message is deleted first
   * (`ChatService.reportedMessageState` on the report path) — this neither
   * authorizes nor checks, and on a message still in place it would delete
   * files that message still shows.
   */
  async purgeRemovedMessageAttachments(
    messageId: string,
    chapterId: string,
  ): Promise<void> {
    let attachments: ChatMessageAttachment[];
    try {
      attachments = await this.attachmentRepo.findByMessage(
        messageId,
        chapterId,
      );
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Could not read attachments to purge for message ${messageId}`,
        error,
      );
      return;
    }
    if (attachments.length === 0) return;

    let shared: { bucket: string; storage_path: string }[];
    try {
      shared = await this.attachmentRepo.findSharedObjects(
        attachments.map(({ bucket, storage_path }) => ({
          bucket,
          storage_path,
        })),
        messageId,
      );
    } catch (error) {
      // Fail closed: an unanswerable "is this shared?" must not be read as
      // "no". Keeping an orphan costs storage; guessing wrong destroys a live
      // message's file.
      logThrowable(
        this.logger,
        'warn',
        `Could not check shared attachments for message ${messageId} (${attachments.length} attachments); keeping objects`,
        error,
      );
      return;
    }

    const sharedKeys = objectKeys(shared);
    const unshared = uniqueObjects(attachments).filter(
      (object) => !sharedKeys.has(objectKey(object)),
    );

    // A report holds what it names until its release finishes (#2481): the
    // sender deleting a reported photo must not take the evidence with it.
    // Asked by object, not by this message, because another message can reach
    // the same object (#1622) and a report on *that* message holds it too.
    // Only asked when there is something left to delete.
    let heldKeys = new Set<string>();
    if (unshared.length > 0) {
      try {
        heldKeys = objectKeys(await this.reportRepo.findHeldObjects(chapterId));
      } catch (error) {
        // Fail closed, as the shared check does: an unanswerable "does a
        // report hold this?" must not be read as "no". An orphan costs
        // storage; a wrong guess destroys the evidence a report exists for.
        logThrowable(
          this.logger,
          'warn',
          `Could not check reported attachments for message ${messageId} (${unshared.length} attachments); keeping objects`,
          error,
        );
        return;
      }
    }
    const doomed = unshared.filter(
      (object) => !heldKeys.has(objectKey(object)),
    );

    await this.deleteChatObjects(doomed, { messageId });

    const keptCount = sharedKeys.size + (unshared.length - doomed.length);
    if (keptCount > 0) {
      this.logger.log('Kept chat attachment objects still referenced', {
        messageId,
        keptCount,
        heldByReports: unshared.length - doomed.length,
      });
    }
  }

  /**
   * Delete chat objects, grouped per bucket, and answer the buckets whose
   * delete failed. Failures are logged, never thrown: both callers are
   * best-effort, and a `chat` outage must not skip the `chat-archive` deletes.
   */
  private async deleteChatObjects(
    objects: readonly StoredObjectRef[],
    context: Record<string, unknown>,
  ): Promise<Set<string>> {
    const byBucket = new Map<string, string[]>();
    for (const { bucket, storage_path } of objects) {
      const paths = byBucket.get(bucket) ?? [];
      paths.push(storage_path);
      byBucket.set(bucket, paths);
    }

    const failed = new Set<string>();
    for (const [bucket, paths] of byBucket) {
      try {
        await this.storageProvider.deleteFiles(bucket, paths);
      } catch (error) {
        // Per bucket, and naming the paths: an operator reconciling orphans by
        // hand needs to know which objects survived.
        failed.add(bucket);
        logThrowable(
          this.logger,
          'warn',
          `Failed to purge chat attachment objects ${JSON.stringify({ ...context, bucket, paths })}`,
          error,
        );
      }
    }
    return failed;
  }

  // ── Report evidence (#2481) ──────────────────────────────────────────
  //
  // An open report keeps the reported message's attachments: the snapshot it
  // takes names the objects, the purges above leave them alone, and the
  // report's resolution releases them. `ChatReportService` owns the report
  // rows; these own the attachment reads and the bytes.

  /**
   * The attachments a report on this message snapshots: its
   * `chat_message_attachments` rows, as the officer will need them.
   *
   * **Throws on a failed read**, unlike the purge. It runs before the report
   * is written, so a failure files nothing and a retry files the report whole;
   * swallowing it would file a report that looks complete and holds nothing.
   * Callers authorize the message first; this does not.
   */
  async reportedAttachmentsSnapshot(
    messageId: string,
    chapterId: string,
  ): Promise<ReportedAttachment[]> {
    const rows = await this.attachmentRepo.findByMessage(messageId, chapterId);
    return rows.map(
      ({ bucket, storage_path, filename, content_type, byte_size }) => ({
        bucket,
        storage_path,
        filename,
        content_type,
        byte_size,
      }),
    );
  }

  /**
   * Release resolved reports' evidence, all in `chapterId`, and answer which
   * of them finished. Each object they held is
   *
   * - **kept, and done with**, while an undeleted message still references it
   *   (the reported message itself counts, so a report dismissed over a live
   *   message deletes nothing; the message's own delete purges later) or an
   *   **open** report holds it (that report releases it in its turn);
   * - **kept, and waited on**, while a report that resolved after
   *   `claimWindowStart` holds it: that may be a removal's claim still in
   *   flight, which can be withdrawn back to `open`, so its evidence must not
   *   go yet;
   * - **deleted** otherwise, including when the only other holders resolved
   *   before the window: a release that failed long ago will never reopen.
   *
   * The reports being released never hold against each other. A report
   * finished when each of its objects was kept-and-done-with or deleted from
   * a bucket whose delete succeeded; one that waits or hit a failed bucket is
   * left for the hourly sweep, and the others are not held back by it.
   *
   * The reads fail closed, like the purge's: nothing is deleted, and nothing
   * finishes, on an answer that could not be had. Deleting an object that is
   * already gone succeeds, so a release that runs twice is harmless.
   */
  async releaseReportEvidence(
    chapterId: string,
    reports: readonly Pick<ReportEvidence, 'id' | 'reported_attachments'>[],
    claimWindowStart: Date,
  ): Promise<Set<string>> {
    const finished = new Set<string>();
    const objects = uniqueObjects(
      reports.flatMap(({ reported_attachments }) => reported_attachments),
    );

    let live = new Set<string>();
    let heldBy = new Map<string, HeldObject>();
    if (objects.length > 0) {
      try {
        live = objectKeys(
          await this.attachmentRepo.findSharedObjects(objects, null),
        );
        const held = await this.reportRepo.findHeldObjects(
          chapterId,
          reports.map(({ id }) => id),
        );
        heldBy = new Map(held.map((object) => [objectKey(object), object]));
      } catch (error) {
        logThrowable(
          this.logger,
          'warn',
          `Could not check report evidence before releasing it in chapter ${chapterId} (${objects.length} attachments)`,
          error,
        );
        return finished;
      }
    }

    const outcome = new Map<string, 'kept' | 'waiting' | 'doomed'>();
    for (const object of objects) {
      const key = objectKey(object);
      const holder = heldBy.get(key);
      if (live.has(key) || holder?.heldOpen) {
        outcome.set(key, 'kept');
      } else if (
        holder?.pendingSince != null &&
        Date.parse(holder.pendingSince) > claimWindowStart.getTime()
      ) {
        outcome.set(key, 'waiting');
      } else {
        outcome.set(key, 'doomed');
      }
    }

    const doomed = objects.filter(
      (object) => outcome.get(objectKey(object)) === 'doomed',
    );
    const failedBuckets = await this.deleteChatObjects(doomed, {
      chapterId,
      releasingReportIds: reports.map(({ id }) => id),
    });

    for (const report of reports) {
      const done = report.reported_attachments.every((object) => {
        const state = outcome.get(objectKey(object));
        return (
          state === 'kept' ||
          (state === 'doomed' && !failedBuckets.has(object.bucket))
        );
      });
      if (done) finished.add(report.id);
    }
    return finished;
  }

  /**
   * Forced-download signed URLs for a report's held attachments, for the
   * officer route (`ChatReportService.listReportEvidence`), which authorizes
   * the report first.
   *
   * Signed through {@link signChatObjects}, the same path as a message's own
   * attachments, so the forced download that keeps a mislabeled object from
   * rendering applies here too; an `<img>` still renders an image served this
   * way. An object that cannot be signed is logged and omitted.
   */
  async signReportEvidence(
    reportId: string,
    attachments: readonly ReportedAttachment[],
  ): Promise<ReportedAttachmentWithUrl[]> {
    const urls = await this.signChatObjects(attachments, { reportId });
    return attachments.flatMap((attachment) => {
      const downloadUrl = urls.get(objectKey(attachment));
      if (!downloadUrl) return [];
      return [
        {
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size,
          download_url: downloadUrl,
        },
      ];
    });
  }
}

/** One stored object's identity, as the purge and the hold compare it. */
function objectKey(object: StoredObjectRef): string {
  return `${object.bucket} ${object.storage_path}`;
}

function objectKeys(objects: readonly StoredObjectRef[]): Set<string> {
  return new Set(objects.map(objectKey));
}

/** Each object once, keeping only its bucket and path. */
function uniqueObjects(objects: readonly StoredObjectRef[]): StoredObjectRef[] {
  const seen = new Set<string>();
  const unique: StoredObjectRef[] = [];
  for (const { bucket, storage_path } of objects) {
    const key = objectKey({ bucket, storage_path });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ bucket, storage_path });
  }
  return unique;
}
