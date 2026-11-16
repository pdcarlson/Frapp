import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { isAllowedUploadMime, MAX_UPLOAD_BYTES } from '@repo/validation';
import {
  GOOGLE_DRIVE_API,
  GOOGLE_DRIVE_FOLDER_MIME,
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
  CHAPTER_DRIVE_REPOSITORY,
  type IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDocument } from '#domain/entities/chapter-document.entity';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import { safeObjectFilename } from '#domain/constants/storage';
import {
  ChapterDocumentService,
  DOCUMENTS_BUCKET,
} from '../chapter-document.service';
import { toReportableError } from '../../../infrastructure/observability/reportable-error';

/** Folder levels read: the folder itself and two below it. */
const DRIVE_MAX_DEPTH = 3;
/** Files a folder brings into Documents at most; the rest are skipped. */
export const DRIVE_MAX_FILES = 500;
/** Files copied (new or changed) per pass; a bigger change takes a few passes. */
export const DRIVE_COPY_BUDGET = 20;
/** Folders listed per pass, so a folder of folders can't stall a pass. */
const DRIVE_MAX_FOLDERS = 100;
/** Google's own types Frapp turns into files people can open anywhere. */
const EXPORTS: Record<string, { mime: string; extension: string }> = {
  'application/vnd.google-apps.document': {
    mime: 'application/pdf',
    extension: 'pdf',
  },
  'application/vnd.google-apps.presentation': {
    mime: 'application/pdf',
    extension: 'pdf',
  },
  'application/vnd.google-apps.spreadsheet': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
};
/** Extensions a title drops, the way an upload's title does. */
const TITLE_EXTENSION =
  /\.(pdf|docx?|xlsx?|pptx?|txt|csv|jpe?g|png|gif|webp|heic|heif)$/i;

export type DriveSyncOutcome =
  'synced' | 'more' | 'no_access' | 'rate_limited' | 'disconnected';

/** One Drive file as Documents should hold it. */
interface PlannedFile {
  item: GoogleDriveItem;
  /** The Frapp folder: null at the top, else the subfolder path. */
  folder: string | null;
  title: string;
  filename: string;
  contentType: string;
  /** Set for a Google Doc, Sheet or Slides, which are exported. */
  exportMime: string | null;
}

/**
 * Copies a chapter's connected Google Drive folder into Documents and keeps
 * the copies matching it (#5157; `spec/behavior/chapter-docs.md` § Google
 * Drive folder). The worker hands it one claimed connection at a time.
 *
 * A pass reads the folder tree, files new and changed files (up to
 * `DRIVE_COPY_BUDGET`, the rest next pass, which is then due at once),
 * renames and refiles copies whose name or folder changed without
 * re-downloading them, and removes copies of files that left the folder.
 * Drive's modified time says whether a file changed.
 */
@Injectable()
export class GoogleDriveSyncService {
  private readonly logger = new Logger(GoogleDriveSyncService.name);

  constructor(
    @Inject(GOOGLE_DRIVE_API) private readonly drive: IGoogleDriveApi,
    @Inject(CHAPTER_DRIVE_REPOSITORY)
    private readonly connections: IChapterDriveRepository,
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documents: IChapterDocumentRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
    private readonly documentService: ChapterDocumentService,
  ) {}

  isAvailable(): boolean {
    return this.drive.isConfigured();
  }

  async process(
    connection: ChapterDriveConnection,
    now: Date,
  ): Promise<DriveSyncOutcome> {
    try {
      if (connection.status === 'disconnecting') {
        await this.removeCopies(connection.chapter_id);
        await this.connections.delete(connection.id);
        return 'disconnected';
      }
      return await this.sync(connection, now);
    } catch (error) {
      if (error instanceof GoogleDriveApiError) {
        if (error.kind === 'not_found' || error.kind === 'forbidden') {
          await this.connections.finishSync(connection.id, {
            status: 'no_access',
            last_error: 'no_access',
          });
          return 'no_access';
        }
        if (error.kind === 'rate_limited') {
          await this.connections.finishSync(connection.id, {
            last_error: 'rate_limited',
            sync_due_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
          });
          return 'rate_limited';
        }
        await this.connections.finishSync(connection.id, {
          last_error: error.reason,
          sync_due_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        });
      } else if (connection.status === 'disconnecting') {
        // Released, a disconnecting row is claimed again on the next tick.
        await this.connections.releaseLease(connection.id).catch(() => {});
      } else {
        await this.connections
          .finishSync(connection.id, {
            last_error: 'failed',
            sync_due_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
          })
          .catch(() => this.connections.releaseLease(connection.id))
          .catch(() => {});
      }
      throw error;
    }
  }

  private async sync(
    connection: ChapterDriveConnection,
    now: Date,
  ): Promise<DriveSyncOutcome> {
    const chapterId = connection.chapter_id;
    const root = await this.drive.getItem(connection.folder_id);
    if (root.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      throw new GoogleDriveApiError('not_found', null, 'not_a_folder');
    }

    const { planned, skipped, complete } = await this.plan(root.id);
    const existing = await this.documents.findDriveCopies(chapterId);
    const byFile = new Map(
      existing.map((doc) => [doc.drive_file_id as string, doc]),
    );
    const wanted = new Set(planned.map((file) => file.item.id));

    // Copies of files that left the folder (or turned unsupported) go first,
    // so a file moved between subfolders is never filed twice. A tree read
    // only in part can't tell a file that left from one it didn't reach, so
    // its copies stay until a full read.
    const gone = complete
      ? existing.filter((doc) => !wanted.has(doc.drive_file_id as string))
      : [];
    await this.removeDocuments(chapterId, gone);

    let budget = DRIVE_COPY_BUDGET;
    // Files Google won't hand over are tried again each pass, but only this
    // many, so they can't take every pass's budget from readable files.
    let failures = DRIVE_COPY_BUDGET;
    let more = false;
    let filed = 0;
    let unreadable = 0;
    const toCopy: PlannedFile[] = [];
    for (const file of planned) {
      const copy = byFile.get(file.item.id);
      if (copy && sameInstant(copy.drive_modified_at, file.item.modifiedTime)) {
        await this.refile(chapterId, copy, file);
        filed += 1;
      } else {
        toCopy.push(file);
      }
    }
    // In a fresh order each pass, so files Google keeps refusing can't hold
    // the same place ahead of readable ones pass after pass.
    for (const file of shuffled(toCopy)) {
      const copy = byFile.get(file.item.id);
      if (budget === 0 || failures === 0) {
        if (budget === 0) more = true;
        if (copy) filed += 1;
        else if (failures === 0) unreadable += 1;
        continue;
      }
      const ok = await this.copy(connection, file, copy ?? null);
      if (ok) {
        budget -= 1;
        filed += 1;
        continue;
      }
      failures -= 1;
      if (copy) {
        // Unreadable now (too big after an edit, or Google refused it): the
        // stale copy goes rather than standing in for the current file.
        await this.removeDocuments(chapterId, [copy]);
        unreadable += 1;
      } else {
        unreadable += 1;
      }
    }

    await this.connections.finishSync(connection.id, {
      status: 'active',
      folder_name: root.name || connection.folder_name,
      last_synced_at: now.toISOString(),
      last_error: null,
      synced_count: filed,
      skipped_count: skipped + unreadable,
      ...(more ? { sync_due_at: now.toISOString() } : {}),
    });
    return more ? 'more' : 'synced';
  }

  /** The folder tree as files Documents should hold, and how many it can't. */
  private async plan(
    rootId: string,
  ): Promise<{ planned: PlannedFile[]; skipped: number; complete: boolean }> {
    const planned: PlannedFile[] = [];
    let skipped = 0;
    let complete = true;
    let listed = 0;
    const queue: { id: string; path: string | null; depth: number }[] = [
      { id: rootId, path: null, depth: 0 },
    ];
    const seen = new Set<string>([rootId]);
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (listed >= DRIVE_MAX_FOLDERS) {
        complete = false;
        break;
      }
      listed += 1;
      let children: GoogleDriveItem[];
      try {
        children = await this.drive.listChildren(next.id);
      } catch (error) {
        // A subfolder deleted or unshared mid-read is left for the next
        // pass; only the folder itself going says Frapp lost access.
        if (
          next.depth > 0 &&
          error instanceof GoogleDriveApiError &&
          (error.kind === 'not_found' || error.kind === 'forbidden')
        ) {
          complete = false;
          continue;
        }
        throw error;
      }
      for (const item of children) {
        if (item.mimeType === GOOGLE_DRIVE_FOLDER_MIME) {
          // Deeper levels, and a folder shared into itself, are left out.
          if (next.depth + 1 < DRIVE_MAX_DEPTH && !seen.has(item.id)) {
            seen.add(item.id);
            const name = cleanName(item.name) || 'Untitled folder';
            queue.push({
              id: item.id,
              // A folder name in Frapp is at most 100 characters.
              path: (next.path ? `${next.path} / ${name}` : name)
                .slice(0, 100)
                .trim(),
              depth: next.depth + 1,
            });
          }
          continue;
        }
        const file = planFile(item, next.path);
        if (!file || planned.length >= DRIVE_MAX_FILES) {
          skipped += 1;
          continue;
        }
        planned.push(file);
      }
    }
    return { planned, skipped, complete };
  }

  /** Brings a copy's name, folder and link up to date without re-copying it. */
  private async refile(
    chapterId: string,
    copy: ChapterDocument,
    file: PlannedFile,
  ): Promise<void> {
    if (
      copy.title === file.title &&
      copy.folder === file.folder &&
      copy.drive_url === file.item.webViewLink
    ) {
      return;
    }
    if (file.folder !== null) {
      await this.documentService.ensureFolder(file.folder, chapterId);
    }
    await this.documents.updateDriveCopy(copy.id, chapterId, {
      title: file.title,
      folder: file.folder,
      drive_url: file.item.webViewLink,
    });
  }

  /**
   * Copies one file into storage and files it (or replaces an older copy).
   * False when Google won't hand it over, or it is too big: it is skipped.
   */
  private async copy(
    connection: ChapterDriveConnection,
    file: PlannedFile,
    previous: ChapterDocument | null,
  ): Promise<boolean> {
    const chapterId = connection.chapter_id;
    let bytes: Uint8Array;
    try {
      bytes = file.exportMime
        ? await this.drive.exportAs(
            file.item.id,
            file.exportMime,
            MAX_UPLOAD_BYTES,
          )
        : await this.drive.download(file.item.id, MAX_UPLOAD_BYTES);
    } catch (error) {
      if (
        error instanceof GoogleDriveApiError &&
        (error.kind === 'too_large' ||
          error.kind === 'not_found' ||
          error.kind === 'forbidden')
      ) {
        return false;
      }
      throw error;
    }

    const storagePath = `chapters/${chapterId}/documents/${randomUUID()}/${safeObjectFilename(file.filename)}`;
    await this.storage.uploadFile(
      DOCUMENTS_BUCKET,
      storagePath,
      bytes,
      file.contentType,
    );
    if (file.folder !== null) {
      await this.documentService.ensureFolder(file.folder, chapterId);
    }
    if (previous) {
      await this.documents.updateDriveCopy(previous.id, chapterId, {
        title: file.title,
        folder: file.folder,
        storage_path: storagePath,
        content_type: file.contentType,
        byte_size: bytes.byteLength,
        drive_modified_at: file.item.modifiedTime,
        drive_url: file.item.webViewLink,
      });
      await this.storage
        .deleteFile(DOCUMENTS_BUCKET, previous.storage_path)
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not remove a replaced Drive copy's old file: ${toReportableError(error).message}`,
          ),
        );
      return true;
    }
    await this.documents.create({
      chapter_id: chapterId,
      title: file.title,
      description: null,
      folder: file.folder,
      storage_path: storagePath,
      uploaded_by: connection.connected_by,
      content_type: file.contentType,
      byte_size: bytes.byteLength,
      document_type: null,
      effective_date: null,
      drive_file_id: file.item.id,
      drive_modified_at: file.item.modifiedTime,
      drive_url: file.item.webViewLink,
    });
    return true;
  }

  /** Every copy in the chapter goes: the folder was disconnected. */
  private async removeCopies(chapterId: string): Promise<void> {
    const copies = await this.documents.findDriveCopies(chapterId);
    await this.removeDocuments(chapterId, copies);
  }

  private async removeDocuments(
    chapterId: string,
    copies: ChapterDocument[],
  ): Promise<void> {
    if (copies.length === 0) return;
    // Rows first: a row whose object is gone would show a broken file, while
    // an object whose row is gone is only storage nobody can reach.
    for (const copy of copies) {
      await this.documents.delete(copy.id, chapterId);
    }
    await this.storage
      .deleteFiles(
        DOCUMENTS_BUCKET,
        copies.map((copy) => copy.storage_path),
      )
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not remove ${copies.length} Drive copy file(s): ${toReportableError(error).message}`,
        ),
      );
  }
}

/** A Drive file as Documents would hold it, or null when Documents can't. */
export function planFile(
  item: GoogleDriveItem,
  folder: string | null,
): PlannedFile | null {
  const name = cleanName(item.name);
  if (!item.id || !name) return null;
  const exported = EXPORTS[item.mimeType];
  if (exported) {
    return {
      item,
      folder,
      title: name,
      filename: `${name}.${exported.extension}`,
      contentType: exported.mime,
      exportMime: exported.mime,
    };
  }
  // Forms, shortcuts, drawings, sites and the rest of Google's own types have
  // no file to copy.
  if (item.mimeType.startsWith('application/vnd.google-apps.')) return null;
  if (!isAllowedUploadMime('document', item.mimeType)) return null;
  if (item.size !== null && item.size > MAX_UPLOAD_BYTES) return null;
  return {
    item,
    folder,
    title: name.replace(TITLE_EXTENSION, '') || name,
    filename: name,
    contentType: item.mimeType,
    exportMime: null,
  };
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Postgres hands back `+00:00` where Drive wrote `.000Z`: compare instants. */
function sameInstant(stored: string | null, drive: string): boolean {
  if (!stored || !drive) return false;
  const a = Date.parse(stored);
  return !Number.isNaN(a) && a === Date.parse(drive);
}

/** Drive allows names Frapp folders and titles don't: trim and cap them. */
function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 200);
}
