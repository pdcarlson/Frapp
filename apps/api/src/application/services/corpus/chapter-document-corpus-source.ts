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
import {
  CHAPTER_DOCUMENT_FOLDER_REPOSITORY,
  type IChapterDocumentFolderRepository,
} from '#domain/repositories/chapter-document-folder.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  canSeeDocument,
  folderListsByName,
} from '#domain/utils/document-access';
import { RbacService } from '../rbac.service';
import type { CorpusSourceAdapter, CorpusSourceRead } from './corpus-source';

const DOCUMENTS_BUCKET = 'documents';

/**
 * Chapter Docs as a corpus source (#720).
 *
 * Who may read: whoever may open the library, which is `members:view`
 * (`spec/behavior/chapter-docs.md` § Permissions), and then only the files
 * they see there (§ Who can see, #3642 piece 1): the same
 * `document-access.ts` answer the library's own list gives, so Ask never
 * quotes a file the member can't open.
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
    @Inject(CHAPTER_DOCUMENT_FOLDER_REPOSITORY)
    private readonly folders: IChapterDocumentFolderRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
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
        // A bare date read at noon UTC, not midnight: midnight UTC is the
        // evening before in every zone west of UTC, so Ask dated a file a day
        // early and a same-day `since` search missed it. Noon is the same day
        // from UTC-11 to UTC+11. Uploads start on the upload day (#5207).
        sourceAt: document.effective_date
          ? new Date(
              `${document.effective_date.slice(0, 10)}T12:00:00Z`,
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
    if (!mayOpenLibrary) return new Set();
    const [documents, folders, member] = await Promise.all([
      this.documents.findByIds([...sourceIds], chapterId),
      this.folders.findByChapter(chapterId),
      this.members.findByUserAndChapter(userId, chapterId),
    ]);
    const viewer = {
      userId,
      holder: await this.rbac.getChannelAccessHolder(chapterId, member, true),
    };
    const lists = folderListsByName(folders);
    return new Set(
      documents
        .filter((document) => canSeeDocument(document, lists, viewer))
        .map((document) => document.id),
    );
  }
}
