import * as path from 'path';
import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CHAPTER_DOCUMENT_REPOSITORY,
  type ChapterDocumentFilter,
} from '../../domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentRepository } from '../../domain/repositories/chapter-document.repository.interface';
import type { ChapterDocument } from '../../domain/entities/chapter-document.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.csv',
]);

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
}

@Injectable()
export class ChapterDocumentService {
  constructor(
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IChapterDocumentRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  async requestUploadUrl(input: RequestUploadUrlInput) {
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
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
    return this.documentRepo.create({
      chapter_id: input.chapter_id,
      title: input.title,
      description: input.description ?? null,
      folder: input.folder ?? null,
      storage_path: input.storage_path,
      uploaded_by: input.uploaded_by,
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

  async deleteFolder(folder: string, chapterId: string): Promise<void> {
    await this.documentRepo.moveToRoot(folder, chapterId);
  }
}
