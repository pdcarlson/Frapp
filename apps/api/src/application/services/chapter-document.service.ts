import * as path from 'path';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
} from '@repo/validation';
import {
  CHAPTER_DOCUMENT_REPOSITORY,
  type ChapterDocumentFilter,
} from '../../domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentRepository } from '../../domain/repositories/chapter-document.repository.interface';
import { CHAPTER_DOCUMENT_FOLDER_REPOSITORY } from '../../domain/repositories/chapter-document-folder.repository.interface';
import type { IChapterDocumentFolderRepository } from '../../domain/repositories/chapter-document-folder.repository.interface';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
} from '../../domain/entities/chapter-document.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { assertSafeStoragePath } from '../../domain/utils/storage-path';

const DOCUMENTS_BUCKET = 'documents';

export interface RequestUploadUrlInput {
  chapterId: string;
  filename: string;
  contentType: string;
}

export interface ConfirmUploadInput {
  chapter_id: string;
  title: string;
  description?: string | null;
  folder?: string | null;
  storage_path: string;
  uploaded_by: string;
  content_type?: string | null;
  byte_size?: number | null;
  document_type?: string | null;
  effective_date?: string | null;
}

@Injectable()
export class ChapterDocumentService {
  constructor(
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IChapterDocumentRepository,
    @Inject(CHAPTER_DOCUMENT_FOLDER_REPOSITORY)
    private readonly folderRepo: IChapterDocumentFolderRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  async requestUploadUrl(input: RequestUploadUrlInput) {
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!isAllowedUploadExtension('document', ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!isAllowedUploadMime('document', input.contentType)) {
      throw new BadRequestException(
        `Content type "${input.contentType}" is not allowed`,
      );
    }

    const documentId = crypto.randomUUID();
    const storagePath = `chapters/${input.chapterId}/documents/${documentId}/${path.basename(input.filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      DOCUMENTS_BUCKET,
      storagePath,
      input.contentType,
    );

    return { signedUrl, storagePath, documentId };
  }

  async confirmUpload(input: ConfirmUploadInput): Promise<ChapterDocument> {
    if (
      !input.storage_path.startsWith(`chapters/${input.chapter_id}/documents/`)
    ) {
      throw new BadRequestException(
        'storage_path must be within the chapter documents folder',
      );
    }
    // See the equivalent guard in BackworkService.confirmUpload: a prefix check
    // alone lets relative segments through, and this value is persisted and
    // later signed for download.
    assertSafeStoragePath(
      input.storage_path,
      'storage_path must not contain relative path segments',
    );

    const folder = normalizeFolderName(input.folder);

    // Uploading into a folder that was never explicitly created is still
    // allowed — it is how every folder came into being before folders were
    // first-class. Register it so it shows up in the folder list and can be
    // renamed, reordered, and deleted like any other.
    if (folder !== null) {
      await this.ensureFolder(folder, input.chapter_id);
    }

    return this.documentRepo.create({
      chapter_id: input.chapter_id,
      title: input.title,
      description: input.description ?? null,
      folder,
      storage_path: input.storage_path,
      uploaded_by: input.uploaded_by,
      content_type: input.content_type ?? null,
      byte_size: input.byte_size ?? null,
      document_type: input.document_type ?? null,
      effective_date: input.effective_date ?? null,
    });
  }

  async findByChapter(
    chapterId: string,
    filter?: ChapterDocumentFilter,
  ): Promise<ChapterDocument[]> {
    return this.documentRepo.findByChapter(chapterId, filter);
  }

  async findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterDocument & { downloadUrl: string }> {
    const document = await this.documentRepo.findById(id, chapterId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const downloadUrl = await this.storageProvider.getSignedDownloadUrl(
      DOCUMENTS_BUCKET,
      document.storage_path,
    );

    return { ...document, downloadUrl };
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const document = await this.documentRepo.findById(id, chapterId);
    if (!document) {
      throw new NotFoundException('Document not found');
    }

    await this.storageProvider.deleteFile(
      DOCUMENTS_BUCKET,
      document.storage_path,
    );
    await this.documentRepo.delete(id, chapterId);
  }

  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------

  async listFolders(chapterId: string): Promise<ChapterDocumentFolder[]> {
    return this.folderRepo.findByChapter(chapterId);
  }

  async createFolder(
    chapterId: string,
    name: string,
    sortOrder?: number,
  ): Promise<ChapterDocumentFolder> {
    const folderName = normalizeFolderName(name);
    if (folderName === null) {
      throw new BadRequestException('Folder name must not be empty');
    }

    const existing = await this.folderRepo.findByName(chapterId, folderName);
    if (existing) {
      throw new ConflictException(
        `A folder named "${folderName}" already exists`,
      );
    }

    try {
      return await this.folderRepo.create({
        chapter_id: chapterId,
        name: folderName,
        sort_order: sortOrder ?? (await this.nextSortOrder(chapterId)),
      });
    } catch (error) {
      // The check above is advisory — the unique index is the real arbiter, and
      // a concurrent create slips between the two. Report the race as the
      // conflict it is rather than a 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A folder named "${folderName}" already exists`,
        );
      }
      throw error;
    }
  }

  async updateFolder(
    id: string,
    chapterId: string,
    changes: { name?: string; sort_order?: number },
  ): Promise<ChapterDocumentFolder> {
    const folder = await this.folderRepo.findById(id, chapterId);
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const rename =
      changes.name !== undefined
        ? normalizeFolderName(changes.name)
        : undefined;
    if (rename === null) {
      throw new BadRequestException('Folder name must not be empty');
    }

    const isRename = rename !== undefined && rename !== folder.name;

    if (isRename) {
      const conflict = await this.folderRepo.findByName(chapterId, rename);
      if (conflict) {
        throw new ConflictException(
          `A folder named "${rename}" already exists`,
        );
      }
    }

    const patch = {
      ...(isRename ? { name: rename } : {}),
      ...(changes.sort_order !== undefined
        ? { sort_order: changes.sort_order }
        : {}),
    };

    // A PATCH that changes nothing is a no-op, not an error. Every field of
    // UpdateDocumentFolderDto is optional, so `{}` is a valid body — and an
    // empty PostgREST update matches no row, failing `.single()` with PGRST116
    // and surfacing as a 500.
    if (Object.keys(patch).length === 0) return folder;

    // Re-file the documents *before* renaming the folder row, so a failure
    // between the two is self-healing: the row still holds the old name, so
    // retrying the same rename re-runs both steps and converges. Renaming the
    // row first would leave documents under a name no folder claims, and the
    // retry would then see `rename === folder.name`, skip the re-file, and
    // strand them permanently.
    if (isRename) {
      await this.documentRepo.renameFolder(folder.name, rename, chapterId);
    }

    return this.folderRepo.update(id, chapterId, patch);
  }

  async deleteFolder(id: string, chapterId: string): Promise<void> {
    const folder = await this.folderRepo.findById(id, chapterId);
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    // Spec: deleting a folder moves its documents to the root level — no
    // cascading delete of files. Move first, so a failure here leaves the
    // folder intact rather than stranding documents under a deleted name.
    await this.documentRepo.moveToRoot(folder.name, chapterId);
    await this.folderRepo.delete(id, chapterId);
  }

  private async ensureFolder(
    name: string,
    chapterId: string,
  ): Promise<ChapterDocumentFolder> {
    const existing = await this.folderRepo.findByName(chapterId, name);
    if (existing) return existing;

    try {
      return await this.folderRepo.create({
        chapter_id: chapterId,
        name,
        sort_order: await this.nextSortOrder(chapterId),
      });
    } catch (error) {
      // Two uploads naming the same new folder at once both read "absent" and
      // both insert; one loses the unique index. The loser's folder now exists,
      // which is all this method promised — failing the *upload* over it would
      // be gratuitous.
      if (isUniqueViolation(error)) {
        const raced = await this.folderRepo.findByName(chapterId, name);
        if (raced) return raced;
      }
      throw error;
    }
  }

  private async nextSortOrder(chapterId: string): Promise<number> {
    const folders = await this.folderRepo.findByChapter(chapterId);
    if (folders.length === 0) return 0;
    return Math.max(...folders.map((f) => f.sort_order)) + 1;
  }
}

/**
 * Trims a folder name and collapses "no folder" to `null`.
 *
 * Without the trim, `"Governance"` and `" Governance"` are different folders
 * that render identically, and the unique constraint cannot tell them apart.
 */
/** Postgres `unique_violation` (23505), as surfaced by PostgREST. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

function normalizeFolderName(folder: string | null | undefined): string | null {
  if (folder === null || folder === undefined) return null;
  const trimmed = folder.trim();
  return trimmed === '' ? null : trimmed;
}
