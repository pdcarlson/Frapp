import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from '@repo/validation';
import {
  GOOGLE_DRIVE_API,
  GOOGLE_DRIVE_FOLDER_MIME,
  GOOGLE_DRIVE_LINK_PERMISSION_IDS,
  GoogleDriveApiError,
  type GoogleDriveItem,
  type IGoogleDriveApi,
} from '#domain/adapters/google-drive.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  CHAPTER_DOCUMENT_REPOSITORY,
  type IChapterDocumentRepository,
} from '#domain/repositories/chapter-document.repository.interface';
import {
  CHAPTER_DRIVE_LINK_REPOSITORY,
  type IChapterDriveLinkRepository,
} from '#domain/repositories/chapter-drive-link.repository.interface';
import type { ChapterDocument } from '#domain/entities/chapter-document.entity';
import type { ChapterDriveLink } from '#domain/entities/chapter-drive-link.entity';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import {
  ChapterDocumentService,
  DOCUMENTS_BUCKET,
  normalizeFolderName,
} from '../chapter-document.service';
import {
  driveCopyPath,
  planFile,
  sameInstant,
} from './google-drive-sync.service';
import { holdsCode } from './google-drive.service';
import { toReportableError } from '../../../infrastructure/observability/reportable-error';

/** How long a check waits after Google asks Frapp to slow down. */
const RETRY_AFTER_MS = 5 * 60 * 1000;

export interface GoogleDriveLinkInfo {
  available: boolean;
  service_account_email: string | null;
}

export interface AddDriveLinkInput {
  link: string;
  folder?: string | null;
  who_can_see?: string[] | null;
}

export type DriveLinkOutcome =
  'unchanged' | 'updated' | 'no_access' | 'rate_limited' | 'kept' | 'gone';

/** A Drive file a pasted link names. */
export type ParsedDriveFileLink =
  | { kind: 'file'; fileId: string; resourceKey: string | null }
  | { kind: 'folder' }
  | null;

/**
 * One Google Drive file added to Documents by its link, kept matching Drive
 * (#5434; `spec/behavior/chapter-docs.md` § Google Drive file by link).
 *
 * Adding copies the file at once, the way the folder sync copies one (Docs
 * and Slides to PDF, Sheets to .xlsx, the upload allowlist and size cap), and
 * files it as a document with a folder and who-can-see list checked as an
 * upload's are. The worker then checks Drive's modified time about every 15
 * minutes and copies the file again when it changed; Frapp AI re-reads it
 * because the copy's stored file changed.
 *
 * Which files a chapter may link (#5185 again): the service account sees
 * everything any chapter shares with it, so a link alone must not copy
 * another chapter's file. A file anyone with the link can open is linked at
 * once, and stops syncing if that ends. Any other file needs the same code
 * the folder connect asks for, in its name or Description, which only
 * someone who can edit it can put there.
 */
@Injectable()
export class GoogleDriveLinkService {
  private readonly logger = new Logger(GoogleDriveLinkService.name);

  constructor(
    @Inject(GOOGLE_DRIVE_API) private readonly drive: IGoogleDriveApi,
    @Inject(CHAPTER_DRIVE_LINK_REPOSITORY)
    private readonly links: IChapterDriveLinkRepository,
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IChapterDocumentRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
    private readonly documents: ChapterDocumentService,
  ) {}

  info(): GoogleDriveLinkInfo {
    return {
      available: this.drive.isConfigured(),
      service_account_email: this.drive.serviceAccountEmail(),
    };
  }

  isAvailable(): boolean {
    return this.drive.isConfigured();
  }

  async add(
    chapterId: string,
    userId: string,
    input: AddDriveLinkInput,
    now = new Date(),
  ): Promise<ChapterDocument> {
    const email = this.drive.serviceAccountEmail();
    if (!this.drive.isConfigured() || !email) {
      throw new ServiceUnavailableException(
        'Google Drive isn’t available on this server yet.',
      );
    }
    const parsed = parseDriveFileLink(input.link);
    if (parsed?.kind === 'folder') {
      throw new BadRequestException(
        'That’s a folder. Paste the link to one file, or ask an officer to connect the folder.',
      );
    }
    if (!parsed) {
      throw new BadRequestException(
        'That isn’t a Google Drive link. Open the file in Google Drive and copy its link.',
      );
    }
    const folder = normalizeFolderName(input.folder ?? null);
    const whoCanSee = await this.documents.checkedFiling(
      chapterId,
      userId,
      folder,
      input.who_can_see,
    );

    const item = await this.fromDrive(
      () => this.drive.getItem(parsed.fileId, parsed.resourceKey),
      email,
    );
    if (item.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
      throw new BadRequestException(
        'That’s a folder. Paste the link to one file, or ask an officer to connect the folder.',
      );
    }
    if (item.trashed) {
      throw new BadRequestException('That file is in the Google Drive trash.');
    }
    const planned = planFile(item, '');
    if (!planned) {
      throw new BadRequestException(
        'Documents can’t hold that file: it’s over 25 MB, or a type Documents doesn’t take (Google Forms, Drawings and shortcuts can’t be copied).',
      );
    }
    const proven = !openToLink(item, parsed.resourceKey);
    if (proven) this.requireProof(chapterId, item, email);
    // Only once the member has shown they can open the file anyway, so the
    // answer tells them nothing they couldn't see in Drive.
    await this.refuseIfFiled(chapterId, item.id);

    const bytes = await this.fromDrive(
      () => this.bytesOf(planned, parsed.resourceKey),
      email,
    );
    const storagePath = driveCopyPath(chapterId, planned.filename);
    await this.storage.uploadFile(
      DOCUMENTS_BUCKET,
      storagePath,
      bytes,
      planned.contentType,
    );
    let document: ChapterDocument;
    try {
      if (folder !== null) await this.documents.ensureFolder(folder, chapterId);
      document = await this.documentRepo.create({
        chapter_id: chapterId,
        title: planned.title,
        description: null,
        folder,
        storage_path: storagePath,
        uploaded_by: userId,
        content_type: planned.contentType,
        byte_size: bytes.byteLength,
        document_type: null,
        effective_date: null,
        who_can_see: whoCanSee,
        drive_file_id: item.id,
        drive_modified_at: item.modifiedTime,
        drive_url: item.webViewLink,
        drive_link_status: 'active',
        drive_synced_at: now.toISOString(),
      });
    } catch (error) {
      await this.dropObject(storagePath);
      // Someone linked it (or the folder sync copied it) between the check
      // and the write.
      if (isUniqueViolation(error))
        await this.refuseIfFiled(chapterId, item.id);
      throw error;
    }
    try {
      await this.links.create({
        chapter_id: chapterId,
        document_id: document.id,
        file_id: item.id,
        resource_key: parsed.resourceKey,
        linked_by: userId,
        proven,
      });
    } catch (error) {
      // A document that never syncs would look linked and go stale: it goes.
      await this.documentRepo.delete(document.id, chapterId);
      await this.dropObject(storagePath);
      throw error;
    }
    return document;
  }

  /** Brings a linked document's next check forward to the worker's next pass. */
  async syncNow(
    documentId: string,
    chapterId: string,
    userId: string,
  ): Promise<void> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException(
        'Google Drive isn’t available on this server yet.',
      );
    }
    // Refuses a document the member can't see, as opening it would.
    await this.documents.findById(documentId, chapterId, userId);
    if (!(await this.links.markDue(documentId, chapterId, new Date()))) {
      throw new NotFoundException(
        'That document isn’t linked to Google Drive.',
      );
    }
  }

  /**
   * One claimed link's check, for the worker: the copy is replaced when Drive's
   * modified time moved, and marked when Frapp can't see the file any more.
   */
  async process(link: ChapterDriveLink, now: Date): Promise<DriveLinkOutcome> {
    const chapterId = link.chapter_id;
    const document = await this.documentRepo.findById(
      link.document_id,
      chapterId,
    );
    // Deleted mid-check: the link went with it.
    if (!document) return 'gone';
    try {
      const item = await this.drive.getItem(link.file_id, link.resource_key);
      // A file added because anyone with the link could open it is followed
      // only while that holds (see the class comment).
      if (
        item.trashed ||
        (!link.proven && !openToLink(item, link.resource_key))
      ) {
        return await this.lostAccess(
          link,
          document,
          item.trashed ? 'trashed' : 'not_shared_by_link',
        );
      }
      const planned = planFile(item, '');
      if (sameInstant(document.drive_modified_at, item.modifiedTime)) {
        await this.documentRepo.updateDriveCopy(document.id, chapterId, {
          ...(planned ? { title: planned.title } : {}),
          drive_url: item.webViewLink,
          drive_link_status: 'active',
          drive_synced_at: now.toISOString(),
        });
        await this.links.finish(link.id, { last_error: null });
        return 'unchanged';
      }
      if (!planned) {
        // Turned into something Documents can't hold (too big, say): the last
        // copy stays, and its synced time shows how old it is.
        await this.links.finish(link.id, { last_error: 'unsupported' });
        return 'kept';
      }
      let bytes: Uint8Array;
      try {
        bytes = await this.bytesOf(planned, link.resource_key);
      } catch (error) {
        if (
          error instanceof GoogleDriveApiError &&
          error.kind === 'too_large'
        ) {
          await this.links.finish(link.id, { last_error: 'too_large' });
          return 'kept';
        }
        throw error;
      }
      const storagePath = driveCopyPath(chapterId, planned.filename);
      await this.storage.uploadFile(
        DOCUMENTS_BUCKET,
        storagePath,
        bytes,
        planned.contentType,
      );
      let replaced: boolean;
      try {
        replaced = await this.documentRepo.updateDriveCopy(
          document.id,
          chapterId,
          {
            title: planned.title,
            storage_path: storagePath,
            content_type: planned.contentType,
            byte_size: bytes.byteLength,
            drive_modified_at: item.modifiedTime,
            drive_url: item.webViewLink,
            drive_link_status: 'active',
            drive_synced_at: now.toISOString(),
          },
        );
      } catch (error) {
        await this.dropObject(storagePath);
        throw error;
      }
      if (!replaced) {
        // Deleted while this check ran: the new copy has no row to belong to.
        await this.dropObject(storagePath);
        return 'gone';
      }
      await this.dropObject(document.storage_path);
      await this.links.finish(link.id, { last_error: null });
      return 'updated';
    } catch (error) {
      if (error instanceof GoogleDriveApiError) {
        if (error.kind === 'not_found' || error.kind === 'forbidden') {
          return this.lostAccess(link, document, 'no_access');
        }
        await this.links
          .finish(link.id, {
            last_error:
              error.kind === 'rate_limited' ? 'rate_limited' : error.reason,
            sync_due_at: new Date(now.getTime() + RETRY_AFTER_MS).toISOString(),
          })
          .catch(() => {});
        if (error.kind === 'rate_limited') return 'rate_limited';
      } else {
        await this.links
          .finish(link.id, {
            last_error: 'failed',
            sync_due_at: new Date(now.getTime() + RETRY_AFTER_MS).toISOString(),
          })
          .catch(() => {});
      }
      throw error;
    }
  }

  /** The copy stays as it was; the row says Frapp can't see the file. */
  private async lostAccess(
    link: ChapterDriveLink,
    document: ChapterDocument,
    reason: string,
  ): Promise<DriveLinkOutcome> {
    if (document.drive_link_status !== 'no_access') {
      await this.documentRepo.updateDriveCopy(document.id, link.chapter_id, {
        drive_link_status: 'no_access',
      });
    }
    await this.links.finish(link.id, { last_error: reason });
    return 'no_access';
  }

  /**
   * A Drive file already in the chapter's Documents is refused, by where it
   * came from. Never by title: the copy may sit where this member can't see.
   */
  private async refuseIfFiled(
    chapterId: string,
    fileId: string,
  ): Promise<void> {
    const existing = await this.documentRepo.findByDriveFileId(
      chapterId,
      fileId,
    );
    if (!existing) return;
    throw new ConflictException(
      existing.drive_link_status !== null
        ? 'That file is already in Documents.'
        : 'That file already comes from the chapter’s Google Drive folder.',
    );
  }

  /** The connect code (#5185), in the file's name or Description. */
  private requireProof(
    chapterId: string,
    item: GoogleDriveItem,
    email: string,
  ): void {
    const code = this.drive.proofCode(`${chapterId}:${item.id}`);
    if (!code) {
      throw new ServiceUnavailableException(
        'Google Drive isn’t available on this server yet.',
      );
    }
    if (holdsCode(code, item.name) || holdsCode(code, item.description)) {
      return;
    }
    throw new BadRequestException(
      `This file isn’t open to anyone with the link, so Frapp needs to know it’s your chapter’s. Add ${code} to its name in Google Drive (or set it to Anyone with the link), then add it again. Once it’s in, you can rename it back. Frapp reads it as ${email}.`,
    );
  }

  private bytesOf(
    planned: NonNullable<ReturnType<typeof planFile>>,
    resourceKey: string | null,
  ): Promise<Uint8Array> {
    return planned.exportMime
      ? this.drive.exportAs(
          planned.item.id,
          planned.exportMime,
          MAX_UPLOAD_BYTES,
          resourceKey,
        )
      : this.drive.download(planned.item.id, MAX_UPLOAD_BYTES, resourceKey);
  }

  /** One Drive call while adding: what the member can fix is a 400, the rest a 503. */
  private async fromDrive<T>(
    call: () => Promise<T>,
    email: string,
  ): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof GoogleDriveApiError) {
        if (error.kind === 'not_found' || error.kind === 'forbidden') {
          throw new BadRequestException(
            `Frapp can’t open that file. In Google Drive, set it to Anyone with the link, or share it with ${email} as a Viewer, then add it again.`,
          );
        }
        if (error.kind === 'too_large') {
          throw new BadRequestException(
            'That file is over 25 MB once copied, which Documents can’t hold.',
          );
        }
      }
      throw new ServiceUnavailableException(
        'Couldn’t reach Google Drive. Try again in a moment.',
        { cause: toReportableError(error) },
      );
    }
  }

  private async dropObject(path: string): Promise<void> {
    await this.storage
      .deleteFile(DOCUMENTS_BUCKET, path)
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not remove a Drive link copy's file: ${toReportableError(error).message}`,
        ),
      );
  }
}

/**
 * Whether anyone holding the link the member pasted could open the file, as
 * Google tells Frapp: link sharing is on, and when the file needs a resource
 * key (Google's 2021 update), the pasted link carried that very key. Frapp's
 * service account reads such a file without the key when it was shared with
 * it directly, so the key is what shows the member holds a working link.
 */
function openToLink(item: GoogleDriveItem, pastedKey: string | null): boolean {
  const shared = (item.permissionIds ?? []).some((id) =>
    GOOGLE_DRIVE_LINK_PERMISSION_IDS.has(id),
  );
  return shared && (!item.resourceKey || item.resourceKey === pastedKey);
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;

/**
 * The file a pasted Google link names, with its `resourcekey` when the link
 * carries one. Takes Docs, Sheets, Slides and Drive file links
 * (`docs.google.com/<type>/d/<id>/…`, `drive.google.com/file/d/<id>/…`,
 * `drive.google.com/open?id=<id>`, `…/uc?id=<id>`, with `/u/<n>/`), and a
 * bare id. A Drive folder link answers `folder`; anything else, including a
 * "published to the web" link (`/d/e/…`, whose id isn't the file's), null.
 */
export function parseDriveFileLink(input: string): ParsedDriveFileLink {
  const value = input.trim();
  if (DRIVE_ID.test(value)) {
    return { kind: 'file', fileId: value, resourceKey: null };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (
    url.hostname !== 'drive.google.com' &&
    url.hostname !== 'docs.google.com'
  ) {
    return null;
  }
  const rawKey = url.searchParams.get('resourcekey');
  const resourceKey = rawKey && /^[A-Za-z0-9_-]+$/.test(rawKey) ? rawKey : null;
  if (/\/folders\//.test(url.pathname)) return { kind: 'folder' };
  const path = /\/d\/([A-Za-z0-9_-]{10,})(?:\/|$)/.exec(url.pathname);
  if (path) return { kind: 'file', fileId: path[1], resourceKey };
  const id = url.searchParams.get('id');
  if (
    url.hostname === 'drive.google.com' &&
    /^\/(?:u\/\d+\/)?(?:open|uc)$/.test(url.pathname) &&
    id &&
    DRIVE_ID.test(id)
  ) {
    return { kind: 'file', fileId: id, resourceKey };
  }
  return null;
}
