import { Inject, Injectable } from '@nestjs/common';
import {
  DOCUMENT_TEXT_EXTRACTOR,
  type IDocumentTextExtractor,
} from '#domain/adapters/document-text-extractor.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CHAPTER_DOCUMENT_REPOSITORY,
  type IChapterDocumentRepository,
} from '#domain/repositories/chapter-document.repository.interface';
import { RbacService } from '../rbac.service';
import type { CorpusSourceAdapter, CorpusSourceRead } from './corpus-source';

const DOCUMENTS_BUCKET = 'documents';

/**
 * Chapter Docs as a corpus source (#720).
 *
 * Who may read: whoever may open the library, which is `members:view`
 * (`spec/behavior/chapter-docs.md` § Permissions). Every folder is open to
 * every member today; when restricted folders land (#3642) the rule changes
 * here and nowhere else in retrieval.
 *
 * A document does not decay: bylaws and policies are as true next year as
 * today, and an amendment that supersedes one is a second document an answer
 * must show beside it, not a reason to bury the first.
 */
@Injectable()
export class ChapterDocumentCorpusSource implements CorpusSourceAdapter {
  readonly type = 'chapter_document';

  constructor(
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documents: IChapterDocumentRepository,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
    @Inject(DOCUMENT_TEXT_EXTRACTOR)
    private readonly extractor: IDocumentTextExtractor,
    private readonly rbac: RbacService,
  ) {}

  async read(chapterId: string, sourceId: string): Promise<CorpusSourceRead> {
    const document = await this.documents.findById(sourceId, chapterId);
    if (!document) return { status: 'gone' };

    const bytes = await this.storage.downloadFile(
      DOCUMENTS_BUCKET,
      document.storage_path,
    );
    // The row is there and the file is not: nothing to read until it is.
    if (!bytes) return { status: 'skipped', reason: 'unreadable' };

    const path = document.storage_path;
    const extracted = await this.extractor.extract({
      bytes,
      contentType: document.content_type,
      fileName: path.slice(path.lastIndexOf('/') + 1),
    });
    if (extracted.status === 'skipped') return extracted;

    return {
      status: 'ok',
      content: {
        title: document.title,
        sourceAt: document.effective_date
          ? new Date(
              `${document.effective_date.slice(0, 10)}T00:00:00Z`,
            ).toISOString()
          : document.created_at,
        decays: false,
        sections: extracted.sections,
      },
    };
  }

  async readableBy(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>> {
    if (sourceIds.length === 0) return new Set();
    const mayOpenLibrary = await this.rbac.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.MEMBERS_VIEW],
    );
    return mayOpenLibrary ? new Set(sourceIds) : new Set();
  }
}
