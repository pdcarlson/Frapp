import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DOCUMENT_FOLDER_PATH_SEPARATOR,
  isAllowedUploadMime,
  MAX_UPLOAD_BYTES,
} from '@repo/validation';
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
  CHAPTER_DOCUMENT_FOLDER_REPOSITORY,
  type IChapterDocumentFolderRepository,
} from '#domain/repositories/chapter-document-folder.repository.interface';
import {
  CHAPTER_DRIVE_REPOSITORY,
  type IChapterDriveRepository,
} from '#domain/repositories/chapter-drive.repository.interface';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
} from '#domain/entities/chapter-document.entity';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import { safeObjectFilename } from '#domain/constants/storage';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import { listNoWiderThan } from '#domain/utils/document-access';
import { DOCUMENTS_BUCKET } from '../chapter-document.service';
import { toReportableError } from '../../../infrastructure/observability/reportable-error';

/**
 * Folder levels read: the folder itself and nine below it (#5331; until then
 * three, which left most of a real chapter drive out). Past it, folders are
 * counted in `folders_left_out` rather than read.
 */
export const DRIVE_MAX_DEPTH = 10;
/** Files a folder brings into Documents at most; the rest are skipped. */
export const DRIVE_MAX_FILES = 500;
/**
 * Files copied (new or changed) per pass; a bigger change takes a few passes.
 * Each pass lists the whole tree again first, so this is large enough that a
 * full first connect (`DRIVE_MAX_FILES`) takes five passes, not twenty-five.
 */
export const DRIVE_COPY_BUDGET = 100;
/**
 * Folders listed per pass, so a folder of folders can't stall a pass. Each is
 * one Drive list call, plus one per further 1,000 items in it. Folders past it
 * are left out of Documents and counted, the same on every pass (the listing
 * order is Drive's by name).
 */
export const DRIVE_MAX_FOLDERS = 300;
/**
 * How long a pass lists folders before it stops and copies what it found. A
 * listing cut short by time keeps every copy and folder it didn't reach (a
 * read in part) and the next pass reads again. With the copy budget below,
 * this keeps a pass inside the worker's 45-minute lease.
 */
export const DRIVE_LIST_TIME_MS = 10 * 60 * 1000;
/**
 * How long into a pass a new copy may still start; later ones wait for the
 * next pass, which is then due at once. One copy is capped at 90 seconds.
 */
export const DRIVE_COPY_TIME_MS = 25 * 60 * 1000;
/** A Frapp folder name's longest. */
const FOLDER_NAME_MAX = 100;
/** A shortened path's longest, leaving room for `freeName`'s " (2)". */
const SHORTENED_MAX = FOLDER_NAME_MAX - 5;
/** Stands for the middle of a synced folder's path too long to name whole. */
const ELLIPSIS = '…';
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

/** One Drive folder the pass read: the connected one, or one below it. */
interface PlannedFolder {
  driveId: string;
  /** Null for the connected folder itself. */
  parentDriveId: string | null;
  /** Its name in Drive, cleaned. */
  name: string;
  /** Drive names from the connected folder down to this one, itself last. */
  path: string[];
}

/** One Drive file as Documents should hold it. */
interface PlannedFile {
  item: GoogleDriveItem;
  /** The Drive folder it sits in, which names its Frapp folder. */
  folderDriveId: string;
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
 *
 * Who can see a copy (#5220): each Drive folder has one Frapp folder, found
 * by its Drive id, so a rename in Drive renames it and its list stays. The
 * connected folder's starts with the connection's list, and a new subfolder
 * with its parent's. Sync never writes a list after that, and never moves a
 * copy into a folder more people may see: it leaves the copy where it was,
 * marked, until someone who manages documents opens it up.
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
    @Inject(CHAPTER_DOCUMENT_FOLDER_REPOSITORY)
    private readonly folders: IChapterDocumentFolderRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  /** Milliseconds now; a field so specs can move time. */
  protected clock: () => number = () => Date.now();

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
        await this.removeSyncedFolders(connection.chapter_id, () => true);
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
    const startedAt = this.clock();
    const root = await this.drive.getItem(connection.folder_id);
    if (root.mimeType !== GOOGLE_DRIVE_FOLDER_MIME) {
      throw new GoogleDriveApiError('not_found', null, 'not_a_folder');
    }

    const { planned, folders, skipped, complete, foldersLeftOut } =
      await this.plan(
        root,
        startedAt,
        await this.connections.folderIdsConnectedEarlierElsewhere(
          chapterId,
          connection.created_at,
        ),
      );
    // Folders first: a rename re-files the copies in it, so they are read
    // after.
    const filedIn = await this.syncFolders(connection, folders);
    const lists = new Map(
      (await this.folders.findByChapter(chapterId)).map((folder) => [
        folder.name,
        folder.who_can_see ?? null,
      ]),
    );
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
    const toCopy: { file: PlannedFile; folder: ChapterDocumentFolder }[] = [];
    for (const file of planned) {
      const copy = byFile.get(file.item.id);
      // A folder it couldn't make this pass (a name race) waits for the
      // next; the copy stays as it is meanwhile.
      const folder = filedIn.get(file.folderDriveId);
      if (!folder) continue;
      if (copy && sameInstant(copy.drive_modified_at, file.item.modifiedTime)) {
        await this.refile(chapterId, copy, file, place(copy, folder, lists));
        filed += 1;
      } else {
        toCopy.push({ file, folder });
      }
    }
    // In a fresh order each pass, so files Google keeps refusing can't hold
    // the same place ahead of readable ones pass after pass.
    for (const { file, folder } of shuffled(toCopy)) {
      const copy = byFile.get(file.item.id);
      // Out of time counts as out of budget: the rest go next pass.
      if (budget > 0 && this.clock() - startedAt >= DRIVE_COPY_TIME_MS) {
        budget = 0;
      }
      if (budget === 0 || failures === 0) {
        if (budget === 0) more = true;
        if (copy) filed += 1;
        else if (failures === 0) unreadable += 1;
        continue;
      }
      const ok = await this.copy(
        connection,
        file,
        copy ?? null,
        copy ? place(copy, folder, lists) : { folder: folder.name, held: null },
      );
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

    // Folders Drive no longer has go once their copies have: anything else
    // filed there moves to the top level with the folder's list.
    if (complete) {
      const read = new Set(folders.map((folder) => folder.driveId));
      await this.removeSyncedFolders(
        chapterId,
        (folder) => !read.has(folder.drive_folder_id as string),
      );
    }

    await this.connections.finishSync(connection.id, {
      status: 'active',
      folder_name: root.name || connection.folder_name,
      last_synced_at: now.toISOString(),
      last_error: null,
      synced_count: filed,
      skipped_count: skipped + unreadable,
      folders_left_out: foldersLeftOut,
      ...(more ? { sync_due_at: now.toISOString() } : {}),
    });
    return more ? 'more' : 'synced';
  }

  /**
   * The folder tree as folders and files Documents should hold, parents
   * before their children (shallow levels first, so a cap leaves out the
   * deepest), how many files it can't, and how many folders it didn't read.
   */
  private async plan(
    root: GoogleDriveItem,
    startedAt: number,
    /** Folders other chapters connected first: never read into this one. */
    elsewhere: ReadonlySet<string>,
  ): Promise<{
    planned: PlannedFile[];
    folders: PlannedFolder[];
    skipped: number;
    complete: boolean;
    /**
     * The top-most folders past the depth or folder cap. Nothing inside them
     * is read, so folders below them aren't counted.
     */
    foldersLeftOut: number;
  }> {
    const planned: PlannedFile[] = [];
    const rootName = cleanName(root.name) || 'Google Drive';
    const folders: PlannedFolder[] = [
      {
        driveId: root.id,
        parentDriveId: null,
        name: rootName,
        path: [rootName],
      },
    ];
    const pathOf = new Map<string, string[]>([[root.id, [rootName]]]);
    let skipped = 0;
    let complete = true;
    let listed = 0;
    let foldersLeftOut = 0;
    const queue: { id: string; depth: number }[] = [{ id: root.id, depth: 0 }];
    const seen = new Set<string>([root.id]);
    while (queue.length > 0) {
      const next = queue.shift()!;
      const capped = listed >= DRIVE_MAX_FOLDERS;
      if (capped || this.clock() - startedAt >= DRIVE_LIST_TIME_MS) {
        // This folder and every one still waiting go unread, and get no
        // Frapp folder. Past the folder cap the same ones are left out every
        // pass, so it counts as a full read: their copies and synced folders
        // go, and the panel says how many were left. Out of time is a read in
        // part, which keeps them for the next pass.
        const unread = new Set([next.id, ...queue.map((q) => q.id)]);
        const kept = folders.filter((folder) => !unread.has(folder.driveId));
        folders.length = 0;
        folders.push(...kept);
        if (capped) foldersLeftOut += unread.size;
        else complete = false;
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
          // A folder shared into itself is read once, and a folder another
          // chapter connected before this one is that chapter's (#5185).
          if (seen.has(item.id) || elsewhere.has(item.id)) continue;
          seen.add(item.id);
          if (next.depth + 1 >= DRIVE_MAX_DEPTH) {
            // Too deep: counted, so the panel can say files were left out.
            foldersLeftOut += 1;
            continue;
          }
          const name = cleanName(item.name) || 'Untitled folder';
          const path = [...(pathOf.get(next.id) ?? []), name];
          pathOf.set(item.id, path);
          folders.push({
            driveId: item.id,
            parentDriveId: next.id,
            name,
            path,
          });
          queue.push({ id: item.id, depth: next.depth + 1 });
          continue;
        }
        const file = planFile(item, next.id);
        if (!file || planned.length >= DRIVE_MAX_FILES) {
          skipped += 1;
          continue;
        }
        planned.push(file);
      }
    }
    return { planned, folders, skipped, complete, foldersLeftOut };
  }

  /**
   * The Frapp folder for each Drive folder read, by Drive id: renamed to
   * follow Drive (its list kept), or made with its parent's list (the
   * connected folder's with the connection's). A subfolder's name is its
   * path, since Documents folders don't nest. A name another folder holds
   * gets a number.
   */
  private async syncFolders(
    connection: ChapterDriveConnection,
    planned: PlannedFolder[],
  ): Promise<Map<string, ChapterDocumentFolder>> {
    const chapterId = connection.chapter_id;
    const all = await this.folders.findByChapter(chapterId);
    const byDrive = new Map(
      all
        .filter((folder) => folder.drive_folder_id !== null)
        .map((folder) => [folder.drive_folder_id as string, folder]),
    );
    const taken = new Set(all.map((folder) => folder.name));
    let nextOrder =
      all.reduce((max, folder) => Math.max(max, folder.sort_order), -1) + 1;
    const out = new Map<string, ChapterDocumentFolder>();
    for (const folder of planned) {
      const parent =
        folder.parentDriveId === null ? null : out.get(folder.parentDriveId);
      if (parent === undefined) continue;
      const wanted = folderPath(parent?.name ?? null, folder.path);
      const existing = byDrive.get(folder.driveId);
      if (existing) {
        taken.delete(existing.name);
        const name = freeName(wanted, taken);
        taken.add(name);
        if (name === existing.name) {
          out.set(folder.driveId, existing);
          continue;
        }
        try {
          const renamed = await this.folders.rename(
            existing.id,
            chapterId,
            name,
          );
          if (renamed) out.set(folder.driveId, renamed);
        } catch (error) {
          // Someone took the name between the read and the write: keep the
          // folder under its old name, and the next pass tries again.
          if (!isUniqueViolation(error)) throw error;
          out.set(folder.driveId, existing);
        }
        continue;
      }
      const name = freeName(wanted, taken);
      taken.add(name);
      try {
        out.set(
          folder.driveId,
          await this.folders.create({
            chapter_id: chapterId,
            name,
            sort_order: nextOrder,
            who_can_see:
              parent === null ? connection.who_can_see : parent.who_can_see,
            drive_folder_id: folder.driveId,
          }),
        );
        nextOrder += 1;
      } catch (error) {
        // Someone named a folder this between the read and the write; the
        // next pass picks another name. Its files wait for it.
        if (!isUniqueViolation(error)) throw error;
      }
    }
    return out;
  }

  /** Deletes the synced folders `which` picks, moving anything left in them. */
  private async removeSyncedFolders(
    chapterId: string,
    which: (folder: ChapterDocumentFolder) => boolean,
  ): Promise<void> {
    const synced = (await this.folders.findByChapter(chapterId)).filter(
      (folder) => folder.drive_folder_id !== null && which(folder),
    );
    for (const folder of synced) {
      await this.folders.deleteMovingDocuments(folder.id, chapterId);
    }
  }

  /** Brings a copy's name, folder and link up to date without re-copying it. */
  private async refile(
    chapterId: string,
    copy: ChapterDocument,
    file: PlannedFile,
    placement: Placement,
  ): Promise<void> {
    if (
      copy.title === file.title &&
      copy.folder === placement.folder &&
      copy.drive_held_folder_id === placement.held &&
      copy.drive_url === file.item.webViewLink
    ) {
      return;
    }
    await this.documents.updateDriveCopy(copy.id, chapterId, {
      title: file.title,
      folder: placement.folder,
      drive_held_folder_id: placement.held,
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
    placement: Placement,
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
    if (previous) {
      await this.documents.updateDriveCopy(previous.id, chapterId, {
        title: file.title,
        folder: placement.folder,
        drive_held_folder_id: placement.held,
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
      folder: placement.folder,
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
  folderDriveId: string,
): PlannedFile | null {
  const name = cleanName(item.name);
  if (!item.id || !name) return null;
  const exported = EXPORTS[item.mimeType];
  if (exported) {
    return {
      item,
      folderDriveId,
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
    folderDriveId,
    title: name.replace(TITLE_EXTENSION, '') || name,
    filename: name,
    contentType: item.mimeType,
    exportMime: null,
  };
}

/** Where a copy goes, and the folder Drive wanted when it was held back. */
interface Placement {
  folder: string | null;
  held: string | null;
}

/**
 * Where a copy already in Documents goes when Drive files it in `target`:
 * there, unless more people may see `target` than see the folder it is in
 * now. Then it stays, and `held` names `target` for a manager to open up.
 * A copy at the top level, or in a folder no row claims, is open to the
 * chapter already, so any folder is no wider.
 */
function place(
  copy: ChapterDocument,
  target: ChapterDocumentFolder,
  lists: ReadonlyMap<string, string[] | null>,
): Placement {
  if (copy.folder === target.name) {
    return { folder: target.name, held: null };
  }
  const current =
    copy.folder === null ? null : (lists.get(copy.folder) ?? null);
  if (listNoWiderThan(target.who_can_see, current)) {
    return { folder: target.name, held: null };
  }
  return { folder: copy.folder, held: target.id };
}

/**
 * A synced folder's name: its parent's Frapp name and its own, which is its
 * path from the connected folder. A path too long for a folder name is built
 * from its Drive names instead: the connected folder's first, then as many of
 * the last as fit, with "…" between ("Chapter files / … / 2025 / Flyers"), so
 * deep folders stay told apart by their own names rather than cut mid-path.
 * `path` is the Drive names from the connected folder down, itself last; a
 * name is never split, even one holding " / ".
 */
export function folderPath(parent: string | null, path: string[]): string {
  const own = path[path.length - 1] ?? '';
  const full =
    parent === null ? own : `${parent}${DOCUMENT_FOLDER_PATH_SEPARATOR}${own}`;
  if (full.length <= FOLDER_NAME_MAX || path.length < 2) {
    return full.slice(0, FOLDER_NAME_MAX).trim();
  }
  // The connected folder's name gives way first when it is long, so a deep
  // folder's own name always shows.
  const head = path[0].slice(0, 40).trim();
  const tail: string[] = [];
  for (let i = path.length - 1; i > 0; i -= 1) {
    const candidate = [head, ELLIPSIS, path[i], ...tail].join(
      DOCUMENT_FOLDER_PATH_SEPARATOR,
    );
    // Room is left for a " (2)", so a number never cuts its own name.
    if (candidate.length > SHORTENED_MAX) break;
    tail.unshift(path[i]);
  }
  if (tail.length === 0) {
    // Its own name alone is too long to fit beside the head: it is cut.
    return [head, ELLIPSIS, own]
      .join(DOCUMENT_FOLDER_PATH_SEPARATOR)
      .slice(0, SHORTENED_MAX)
      .trim();
  }
  // Nothing was dropped between the head and the tail: no "…" is needed.
  if (tail.length === path.length - 1)
    return [head, ...tail].join(DOCUMENT_FOLDER_PATH_SEPARATOR);
  return [head, ELLIPSIS, ...tail].join(DOCUMENT_FOLDER_PATH_SEPARATOR);
}

/** `wanted`, or `wanted (2)` and up when another folder has the name. */
function freeName(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const name = `${wanted.slice(0, FOLDER_NAME_MAX - suffix.length).trim()}${suffix}`;
    if (!taken.has(name)) return name;
  }
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
