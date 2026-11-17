import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_UPLOAD_LABEL,
  normalizeChannelAccessList,
} from '@repo/validation';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import {
  canSeeDocument,
  canSeeFolder,
  folderListsByName,
  isOwnUpload,
  listsInPlay,
  tiersAListKeeps,
  type DocumentViewer,
} from '#domain/utils/document-access';
import type { ChannelAccessHolder } from '#domain/utils/channel-access';
import {
  CHAPTER_DOCUMENT_REPOSITORY,
  type ChapterDocumentFilter,
} from '#domain/repositories/chapter-document.repository.interface';
import type { IChapterDocumentRepository } from '#domain/repositories/chapter-document.repository.interface';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '#domain/constants/postgres-error-codes';
import { CHAPTER_DOCUMENT_FOLDER_REPOSITORY } from '#domain/repositories/chapter-document-folder.repository.interface';
import type { IChapterDocumentFolderRepository } from '#domain/repositories/chapter-document-folder.repository.interface';
import {
  CHAPTER_DOCUMENT_STAR_REPOSITORY,
  type IChapterDocumentStarRepository,
} from '#domain/repositories/chapter-document-star.repository.interface';
import type {
  ChapterDocument,
  ChapterDocumentFolder,
  ChapterDocumentStarTarget,
  ChapterDocumentStars,
} from '#domain/entities/chapter-document.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { assertSafeStoragePath } from '#domain/utils/storage-path';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  isObjectKeySegment,
  safeObjectFilename,
  storedFilename,
} from '#domain/constants/storage';

import { ChapterDocumentTypeService } from './chapter-document-type.service';
import {
  ChannelAccessListService,
  type ChannelAccessOption,
} from './channel-access-list.service';
import { RbacService } from './rbac.service';

export const DOCUMENTS_BUCKET = 'documents';

/** Ids one `GET /documents/previews` may sign (#4647). */
const MAX_PREVIEW_IDS = 100;
/** A preview link's life: an hour, as the viewer's links. */
const PREVIEW_URL_TTL_SECONDS = 60 * 60;

export interface RequestUploadUrlInput {
  chapterId: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
}

export type RequestUploadUrlFile = Omit<RequestUploadUrlInput, 'chapterId'>;

export type ConfirmUploadResult =
  | { storage_path: string; document: ChapterDocument; error?: never }
  | { storage_path: string; error: string; document?: never };

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
  /**
   * The file's own who can see (#3642): omitted or `null` is the same as its
   * folder; a list narrows the folder's.
   */
  who_can_see?: string[] | null;
}

/** What a who-can-see picker offers the caller (`GET /documents/access-options`). */
export interface DocumentAccessOptions {
  options: ChannelAccessOption[];
  /**
   * The tiers every list the caller sets keeps (their own and those above,
   * Paul's pick 3), shown fixed in the picker; `[]` for `*`, and `null` when
   * the caller ranks outside the tiers and may not set a list.
   */
  always: string[] | null;
}

const NOT_FOUND_DOCUMENT = 'Document not found';
const NOT_FOUND_FOLDER = 'Folder not found';
const SYNCED_FOLDER_IS_DRIVES =
  'This folder comes from Google Drive. Rename or delete it in Drive, and Documents follows.';

@Injectable()
export class ChapterDocumentService {
  constructor(
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IChapterDocumentRepository,
    @Inject(CHAPTER_DOCUMENT_FOLDER_REPOSITORY)
    private readonly folderRepo: IChapterDocumentFolderRepository,
    @Inject(CHAPTER_DOCUMENT_STAR_REPOSITORY)
    private readonly starRepo: IChapterDocumentStarRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    private readonly typeService: ChapterDocumentTypeService,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
    private readonly accessLists: ChannelAccessListService,
  ) {}

  // ---------------------------------------------------------------------------
  // Who can see (#3642 piece 1; `document-access.ts` decides)
  // ---------------------------------------------------------------------------

  /**
   * The member reading Documents: what they hold for lists, and their groups
   * when a list in play names one (`listsInPlay`).
   */
  async viewerFor(
    chapterId: string,
    userId: string,
    withGroups = true,
  ): Promise<DocumentViewer> {
    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    return {
      userId,
      holder: await this.rbac.getChannelAccessHolder(
        chapterId,
        member,
        withGroups,
      ),
    };
  }

  /**
   * The documents in `documents` the member sees. With no list on any
   * folder or file in play, that's all of them, read without the viewer.
   */
  async visibleTo(
    chapterId: string,
    userId: string,
    documents: ChapterDocument[],
  ): Promise<ChapterDocument[]> {
    if (documents.length === 0) return [];
    const folders = await this.folderRepo.findByChapter(chapterId);
    const lists = folderListsByName(folders);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const heldIn = (doc: ChapterDocument) =>
      doc.drive_held_folder_id !== null
        ? byId.get(doc.drive_held_folder_id)
        : undefined;
    const inPlay = listsInPlay([
      ...documents.map((doc) => doc.who_can_see),
      ...documents.map((doc) =>
        doc.folder !== null ? lists.get(doc.folder) : null,
      ),
      ...documents.map((doc) => heldIn(doc)?.who_can_see),
    ]);
    if (!inPlay.any) return documents;
    const viewer = await this.viewerFor(chapterId, userId, inPlay.groups);
    // A held Drive copy names the folder Drive put it in (#5220); a reader
    // who can't see that folder gets no hint it exists.
    return documents
      .filter((doc) => canSeeDocument(doc, lists, viewer))
      .map((doc) => {
        const held = heldIn(doc);
        return held && !canSeeFolder(held, viewer)
          ? { ...doc, drive_held_folder_id: null }
          : doc;
      });
  }

  /**
   * The ids in `documentIds` that every one of `viewers` sees, for Ask's
   * check before an answer is posted to a channel (`AskPostService`): a file
   * one reader can't open is one the post would show them.
   */
  async visibleToAll(
    chapterId: string,
    documentIds: readonly string[],
    viewers: readonly {
      user_id: string;
      channel_access: ChannelAccessHolder;
    }[],
  ): Promise<Set<string>> {
    const ids = [...new Set(documentIds)];
    if (ids.length === 0) return new Set();
    const [documents, folders] = await Promise.all([
      this.documentRepo.findByIds(ids, chapterId),
      this.folderRepo.findByChapter(chapterId),
    ]);
    const lists = folderListsByName(folders);
    return new Set(
      documents
        .filter((doc) =>
          viewers.every((viewer) =>
            canSeeDocument(doc, lists, {
              userId: viewer.user_id,
              holder: viewer.channel_access,
            }),
          ),
        )
        .map((doc) => doc.id),
    );
  }

  /**
   * The document, when the member sees it. One they can't is a 404, as one
   * never there is, so a hidden file's existence doesn't leak.
   */
  private async visibleDocument(
    id: string,
    chapterId: string,
    userId: string,
  ): Promise<ChapterDocument> {
    const document = await this.documentRepo.findById(id, chapterId);
    if (!document) throw new NotFoundException(NOT_FOUND_DOCUMENT);
    const [visible] = await this.visibleTo(chapterId, userId, [document]);
    if (!visible) throw new NotFoundException(NOT_FOUND_DOCUMENT);
    return document;
  }

  /** The folder, when the member sees it; a 404 otherwise. */
  private async visibleFolder(
    id: string,
    chapterId: string,
    userId: string,
  ): Promise<ChapterDocumentFolder> {
    const folder = await this.folderRepo.findById(id, chapterId);
    if (!folder) throw new NotFoundException(NOT_FOUND_FOLDER);
    if (folder.who_can_see === null) return folder;
    const inPlay = listsInPlay([folder.who_can_see]);
    if (
      !canSeeFolder(
        folder,
        await this.viewerFor(chapterId, userId, inPlay.groups),
      )
    ) {
      throw new NotFoundException(NOT_FOUND_FOLDER);
    }
    return folder;
  }

  /** What the caller's who-can-see picker offers, and the tiers it keeps. */
  async accessOptions(
    chapterId: string,
    userId: string,
  ): Promise<DocumentAccessOptions> {
    const [options, context] = await Promise.all([
      this.accessLists.listOptions(chapterId),
      this.rbac.getRankContext(chapterId, userId),
    ]);
    return { options, always: tiersAListKeeps(context.reach, context.tiers) };
  }

  /**
   * A list a write sends, as stored: `undefined` leaves it alone, `null` is
   * everyone (or, on a file, the same as its folder). A list is checked as a
   * channel's is (every entry this chapter's, no class year, not empty) and
   * keeps the caller's tier and every tier above (Paul's pick 3), so nobody
   * hides a file from those who outrank them, or from themselves.
   */
  async checkedList(
    chapterId: string,
    userId: string,
    list: string[] | null | undefined,
  ): Promise<string[] | null | undefined> {
    if (list === undefined || list === null) return list;
    const [{ who_can_see: checked }, context] = await Promise.all([
      this.accessLists.normalize(chapterId, { who_can_see: list }),
      this.rbac.getRankContext(chapterId, userId),
    ]);
    const kept = tiersAListKeeps(context.reach, context.tiers);
    if (kept === null) {
      throw new ForbiddenException(
        "You can't limit who sees a file until you hold a role in one of the chapter's tiers",
      );
    }
    return normalizeChannelAccessList([...(checked ?? []), ...kept]);
  }

  /**
   * Sets who can see one file (`PUT /documents/:id/access`): its uploader, or
   * a member with `chapter_docs:manage`, among those who see it.
   */
  async setDocumentAccess(
    id: string,
    chapterId: string,
    userId: string,
    whoCanSee: string[] | null,
  ): Promise<ChapterDocument> {
    const document = await this.visibleDocument(id, chapterId, userId);
    // A Drive copy's uploader is whoever connected the folder, which makes
    // them no more its owner than anyone else.
    if (
      !isOwnUpload(document, userId) &&
      !(await this.rbac.memberHasAnyPermission(chapterId, userId, [
        SystemPermissions.CHAPTER_DOCS_MANAGE,
      ]))
    ) {
      throw new ForbiddenException(
        'Only whoever uploaded a file, or someone who manages documents, can change who sees it',
      );
    }
    const list = (await this.checkedList(chapterId, userId, whoCanSee)) ?? null;
    const updated = await this.documentRepo.setWhoCanSee(id, chapterId, list);
    if (!updated) throw new NotFoundException(NOT_FOUND_DOCUMENT);
    return updated;
  }

  /**
   * Moves a held Drive copy into the folder Drive put it in (#5220): sync
   * left it where it was because more people may see that folder. Only for
   * a member who manages documents (the route's permission) and sees both
   * the copy and that folder. The next sync finds it where Drive has it.
   */
  async openUpDriveCopy(
    id: string,
    chapterId: string,
    userId: string,
  ): Promise<ChapterDocument> {
    const document = await this.visibleDocument(id, chapterId, userId);
    if (document.drive_held_folder_id === null) {
      throw new ConflictException(
        'This file is already where Google Drive has it',
      );
    }
    const folder = await this.visibleFolder(
      document.drive_held_folder_id,
      chapterId,
      userId,
    );
    await this.documentRepo.updateDriveCopy(id, chapterId, {
      folder: folder.name,
      drive_held_folder_id: null,
    });
    const moved = await this.documentRepo.findById(id, chapterId);
    if (!moved) throw new NotFoundException(NOT_FOUND_DOCUMENT);
    return moved;
  }

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

    if (
      input.sizeBytes !== undefined &&
      !isWithinUploadSizeLimit(input.sizeBytes)
    ) {
      throw new BadRequestException(
        `File exceeds the ${MAX_UPLOAD_LABEL} upload limit`,
      );
    }

    const documentId = crypto.randomUUID();
    const storagePath = `chapters/${input.chapterId}/documents/${documentId}/${safeObjectFilename(input.filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      DOCUMENTS_BUCKET,
      storagePath,
      input.contentType,
    );

    return { signedUrl, storagePath, documentId };
  }

  /**
   * Signed upload links for several files at once (a folder import, #2242),
   * each checked as {@link requestUploadUrl} checks one. One refused file
   * refuses the call, naming which, since the client checked them all first.
   */
  async requestUploadUrls(chapterId: string, files: RequestUploadUrlFile[]) {
    const tickets: Awaited<ReturnType<typeof this.requestUploadUrl>>[] = [];
    for (const [index, file] of files.entries()) {
      try {
        tickets.push(await this.requestUploadUrl({ chapterId, ...file }));
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw new BadRequestException(
            `File ${index + 1} (${file.filename}): ${error.message}`,
          );
        }
        throw error;
      }
    }
    return tickets;
  }

  /**
   * Files several uploads at once (a folder import, #2242), each as
   * {@link confirmUpload} files one. A refusal of one (a bad type, a full
   * type list, a path outside the chapter) is reported against it and the
   * rest still file, since their bytes are already in storage. Anything else
   * fails the call. Confirming is idempotent per stored object, and the web
   * import keeps each file's storage path across retries, so retrying a
   * failed call files what wasn't filed and answers the rest with the
   * documents already filed.
   */
  async confirmUploads(
    inputs: ConfirmUploadInput[],
  ): Promise<ConfirmUploadResult[]> {
    const results: ConfirmUploadResult[] = [];
    for (const input of inputs) {
      try {
        results.push({
          storage_path: input.storage_path,
          document: await this.confirmUpload(input),
        });
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() >= 500) {
          throw error;
        }
        results.push({
          storage_path: input.storage_path,
          error: error.message,
        });
      }
    }
    return results;
  }

  async confirmUpload(input: ConfirmUploadInput): Promise<ChapterDocument> {
    const prefix = `chapters/${input.chapter_id}/documents/`;
    if (!input.storage_path.startsWith(prefix)) {
      throw new BadRequestException(
        'storage_path must be within the chapter documents folder',
      );
    }
    // See the equivalent guard in BackworkService.confirmUpload: a prefix check
    // alone lets relative segments through, and this value is persisted and
    // later signed for download.
    //
    // `assertSafeStoragePath` is domain-layer code and throws a plain `Error`;
    // this catch is what turns that into the `BadRequestException` (400) API
    // consumers have always seen on an unsafe path.
    try {
      assertSafeStoragePath(
        input.storage_path,
        'storage_path must not contain relative path segments',
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    // The rest must be the `{documentId}/{filename}` that `requestUploadUrl`
    // mints. The traversal guard above lets `?`, `#`, `%` and a trailing space
    // through, and a suffixed or percent-encoded spelling of a filed path names the same
    // object while comparing unequal to it, so it would get past the filed-row
    // read and the unique index below and file that object a second time.
    const segments = input.storage_path.slice(prefix.length).split('/');
    if (segments.length !== 2 || !segments.every(isObjectKeySegment)) {
      throw new BadRequestException(
        'storage_path must be a path the upload URL route minted',
      );
    }

    // `requestUploadUrl` validates the declared content type before minting a
    // signed URL, but that validation is not carried into this call — the two
    // are separate requests with no shared state. Without re-checking here, a
    // caller could confirm a real, already-validated upload under an arbitrary
    // `content_type`, corrupting the provenance metadata this column exists to
    // feed (the AI corpus retrieval design).
    if (
      input.content_type != null &&
      !isAllowedUploadMime('document', input.content_type)
    ) {
      throw new BadRequestException(
        `Content type "${input.content_type}" is not allowed`,
      );
    }

    const folder = normalizeFolderName(input.folder);

    // Idempotent on the stored object (#3399): confirming a path that is
    // already filed answers with that row, unchanged, instead of filing it
    // twice. Two rows on one object would break delete, which removes the
    // object. This read comes before the folder is registered, so a replay or
    // a refusal answered here leaves no folder behind. Two confirms racing
    // past it meet the unique index instead, and `create` hands the loser the
    // winner's row; the loser has registered its folder by then, which at
    // worst leaves one empty folder in the uploader's own chapter.
    const filed = await this.documentRepo.findByStoragePath(
      input.storage_path,
      input.chapter_id,
    );
    if (filed) return this.filedFor(filed, input.uploaded_by);

    // Filing into a folder the uploader can't see would hand them a way to
    // add to it unseen; a folder that doesn't exist yet is made open below.
    if (folder !== null) {
      const existing = await this.folderRepo.findByName(
        input.chapter_id,
        folder,
      );
      if (
        existing?.who_can_see &&
        !canSeeFolder(
          existing,
          await this.viewerFor(
            input.chapter_id,
            input.uploaded_by,
            listsInPlay([existing.who_can_see]).groups,
          ),
        )
      ) {
        throw new ForbiddenException("You can't file into that folder");
      }
    }
    const whoCanSee =
      (await this.checkedList(
        input.chapter_id,
        input.uploaded_by,
        input.who_can_see,
      )) ?? null;

    // Uploading into a folder that was never explicitly created is still
    // allowed — it is how every folder came into being before folders were
    // first-class. Register it so it shows up in the folder list and can be
    // renamed, reordered, and deleted like any other.
    // The type is stored in the chapter's own spelling, and a type the
    // chapter doesn't have yet joins its list, as a new folder does
    // (`spec/behavior/chapter-docs.md` § Document types). Resolved before the
    // folder, so a refusal (a full list) leaves no folder behind.
    const documentType = await this.typeService.resolveForUpload(
      input.chapter_id,
      input.document_type,
    );

    if (folder !== null) {
      await this.ensureFolder(folder, input.chapter_id);
    }

    const document = await this.documentRepo.create({
      chapter_id: input.chapter_id,
      title: input.title,
      description: input.description ?? null,
      folder,
      storage_path: input.storage_path,
      uploaded_by: input.uploaded_by,
      content_type: input.content_type ?? null,
      byte_size: input.byte_size ?? null,
      document_type: documentType,
      effective_date: input.effective_date ?? null,
      who_can_see: whoCanSee,
    });
    return this.filedFor(document, input.uploaded_by);
  }

  /**
   * A filed row goes back only to the member who filed it. Every member who
   * can read the library sees a document's `storage_path`, so a confirm from
   * anyone else is not a retry of their own upload.
   */
  private filedFor(
    document: ChapterDocument,
    uploadedBy: string,
  ): ChapterDocument {
    if (document.uploaded_by !== uploadedBy) {
      throw new ConflictException('That upload has already been filed');
    }
    return document;
  }

  /** The chapter's documents the member sees. */
  async findByChapter(
    chapterId: string,
    userId: string,
    filter?: ChapterDocumentFilter,
  ): Promise<ChapterDocument[]> {
    return this.visibleTo(
      chapterId,
      userId,
      await this.documentRepo.findByChapter(chapterId, filter),
    );
  }

  /**
   * The document with two signed links to its file, both good for an hour.
   *
   * - `downloadUrl` serves the file inline: a browser shows a PDF or image
   *   in place. The web viewer reads the file through it (PDF.js fetches it,
   *   an `<img>` draws it, and neither runs it as a page). On the phone only
   *   Ask's document chips still open it in the in-app browser (#5175).
   * - `forcedDownloadUrl` carries `Content-Disposition: attachment` under the
   *   stored filename, so following it saves the file. The web Download
   *   control uses it; before it, Download opened a PDF in a tab.
   *
   * The web viewer reads the inline link without loading the file as a page
   * (pdf.js parses it, an `<img>` draws it). The phone's Documents screen
   * downloads `forcedDownloadUrl` and hands the file to the share sheet
   * instead of opening either link (#4409). Backwork,
   * which has no viewer, signs only a forced download (#3867).
   */
  async findById(
    id: string,
    chapterId: string,
    userId: string,
  ): Promise<
    ChapterDocument & { downloadUrl: string; forcedDownloadUrl: string }
  > {
    const document = await this.visibleDocument(id, chapterId, userId);

    const { inline: downloadUrl, attachment: forcedDownloadUrl } =
      await this.storageProvider.getSignedInlineAndAttachmentUrls(
        DOCUMENTS_BUCKET,
        document.storage_path,
        storedFilename(document.storage_path),
      );

    return { ...document, downloadUrl, forcedDownloadUrl };
  }

  /**
   * Inline links for the web Documents grid's previews (#4647): one signed
   * URL per document, signed in one batch, for at most
   * {@link MAX_PREVIEW_IDS} ids of the caller's chapter. Ids outside the
   * chapter, or gone, are left out, as is a path storage couldn't sign; the
   * tile then shows its type glyph. Unlike {@link findById} it records no
   * `document-viewed` event (the controller's), because a tile coming into
   * view is not a member opening the file. Links last an hour, as the
   * viewer's do.
   */
  async previewUrls(
    ids: string[],
    chapterId: string,
    userId: string,
  ): Promise<{ id: string; url: string }[]> {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_PREVIEW_IDS) {
      throw new BadRequestException(
        `At most ${MAX_PREVIEW_IDS} documents per request`,
      );
    }
    const documents = await this.visibleTo(
      chapterId,
      userId,
      await this.documentRepo.findByIds(unique, chapterId),
    );
    if (documents.length === 0) return [];
    const signed = await this.storageProvider.getSignedDownloadUrls(
      DOCUMENTS_BUCKET,
      documents.map((doc) => doc.storage_path),
      PREVIEW_URL_TTL_SECONDS,
    );
    return documents.flatMap((doc) => {
      const url = signed[doc.storage_path];
      return url ? [{ id: doc.id, url }] : [];
    });
  }

  async delete(id: string, chapterId: string, userId: string): Promise<void> {
    const document = await this.visibleDocument(id, chapterId, userId);
    // Drive owns a copy: deleting it here would only bring it back on the
    // next sync (`spec/behavior/chapter-docs.md` § Google Drive folder).
    if (document.drive_file_id !== null) {
      throw new ConflictException(
        "This file comes from the chapter's Google Drive folder. Remove it in Google Drive.",
      );
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

  /** The chapter's folders the member sees. */
  async listFolders(
    chapterId: string,
    userId: string,
  ): Promise<ChapterDocumentFolder[]> {
    const folders = await this.folderRepo.findByChapter(chapterId);
    const inPlay = listsInPlay(folders.map((folder) => folder.who_can_see));
    if (!inPlay.any) return folders;
    const viewer = await this.viewerFor(chapterId, userId, inPlay.groups);
    return folders.filter((folder) => canSeeFolder(folder, viewer));
  }

  async createFolder(
    chapterId: string,
    name: string,
    sortOrder: number | undefined,
    userId: string,
    whoCanSee?: string[] | null,
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

    const list = (await this.checkedList(chapterId, userId, whoCanSee)) ?? null;
    try {
      return await this.folderRepo.create({
        chapter_id: chapterId,
        name: folderName,
        sort_order: sortOrder ?? (await this.nextSortOrder(chapterId)),
        who_can_see: list,
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
    userId: string,
    changes: {
      name?: string;
      sort_order?: number;
      who_can_see?: string[] | null;
    },
  ): Promise<ChapterDocumentFolder> {
    const folder = await this.visibleFolder(id, chapterId, userId);

    const rename =
      changes.name !== undefined
        ? normalizeFolderName(changes.name)
        : undefined;
    if (rename === null) {
      throw new BadRequestException('Folder name must not be empty');
    }

    const isRename = rename !== undefined && rename !== folder.name;
    // A synced folder's name follows Drive's (#5220): the next sync would put
    // it back, so the rename belongs in Drive.
    if (isRename && folder.drive_folder_id !== null) {
      throw new ConflictException(SYNCED_FOLDER_IS_DRIVES);
    }

    if (isRename) {
      const conflict = await this.folderRepo.findByName(chapterId, rename);
      if (conflict) {
        throw new ConflictException(
          `A folder named "${rename}" already exists`,
        );
      }
    }

    const whoCanSee = await this.checkedList(
      chapterId,
      userId,
      changes.who_can_see,
    );
    const patch = {
      ...(changes.sort_order !== undefined
        ? { sort_order: changes.sort_order }
        : {}),
      ...(whoCanSee !== undefined ? { who_can_see: whoCanSee } : {}),
    };

    // A rename re-files the documents and renames the row in one transaction
    // (`rename_document_folder`): done as two writes, a failure or a lost
    // race between them left the files under a name no folder claims, which
    // for a restricted folder opens them to the chapter. Before the rest of
    // the patch, so a retry of a half-done PATCH sees the new name and only
    // re-applies the rest.
    let current = folder;
    if (isRename) {
      try {
        const renamed = await this.folderRepo.rename(id, chapterId, rename);
        if (!renamed) throw new NotFoundException(NOT_FOUND_FOLDER);
        current = renamed;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException(
            `A folder named "${rename}" already exists`,
          );
        }
        throw error;
      }
    }

    // A PATCH that changes nothing is a no-op, not an error. Every field of
    // UpdateDocumentFolderDto is optional, so `{}` is a valid body — and an
    // empty PostgREST update matches no row, failing `.single()` with PGRST116
    // and surfacing as a 500.
    if (Object.keys(patch).length === 0) return current;
    return this.folderRepo.update(id, chapterId, patch);
  }

  async deleteFolder(
    id: string,
    chapterId: string,
    userId: string,
  ): Promise<void> {
    const folder = await this.visibleFolder(id, chapterId, userId);
    // The next sync would only make it again (#5220).
    if (folder.drive_folder_id !== null) {
      throw new ConflictException(SYNCED_FOLDER_IS_DRIVES);
    }

    // Spec: deleting a folder moves its documents to the root level — no
    // cascading delete of files — and a restricted folder's list goes with
    // them (#3642), all in one transaction (`delete_document_folder`), so no
    // failure part-way strands them under a deleted name or opens them.
    if (!(await this.folderRepo.deleteMovingDocuments(id, chapterId))) {
      throw new NotFoundException(NOT_FOUND_FOLDER);
    }
  }

  // ---------------------------------------------------------------------------
  // Pins (chapter-wide) and stars (each member's own), #3934
  // ---------------------------------------------------------------------------

  /**
   * Pins or unpins a folder for the whole chapter. Pinning a pinned folder
   * keeps its first pin time, so a repeated tap is a no-op. A folder deleted
   * between the read and the write is a 404, as one never there is.
   */
  async setFolderPinned(
    id: string,
    chapterId: string,
    userId: string,
    pinned: boolean,
  ): Promise<ChapterDocumentFolder> {
    const folder = await this.visibleFolder(id, chapterId, userId);
    if ((folder.pinned_at !== null) === pinned) return folder;
    const updated = await this.folderRepo.setPinnedAt(
      id,
      chapterId,
      pinned ? new Date().toISOString() : null,
    );
    if (!updated) {
      throw new NotFoundException('Folder not found');
    }
    return updated;
  }

  /** Pins or unpins a document for the whole chapter, as folders pin. */
  async setDocumentPinned(
    id: string,
    chapterId: string,
    userId: string,
    pinned: boolean,
  ): Promise<ChapterDocument> {
    const document = await this.visibleDocument(id, chapterId, userId);
    if ((document.pinned_at !== null) === pinned) return document;
    const updated = await this.documentRepo.setPinnedAt(
      id,
      chapterId,
      pinned ? new Date().toISOString() : null,
    );
    if (!updated) {
      throw new NotFoundException('Document not found');
    }
    return updated;
  }

  /** The caller's own stars in their active chapter. */
  async listStars(
    userId: string,
    chapterId: string,
  ): Promise<ChapterDocumentStars> {
    const stars = await this.starRepo.findByUser(userId, chapterId);
    const result: ChapterDocumentStars = { folder_ids: [], document_ids: [] };
    for (const star of stars) {
      if (star.folder_id) result.folder_ids.push(star.folder_id);
      if (star.document_id) result.document_ids.push(star.document_id);
    }
    if (result.folder_ids.length === 0 && result.document_ids.length === 0) {
      return result;
    }
    // A star on something the member can no longer see (its folder or its
    // own list changed since) is left out, as every read leaves it out.
    const [folders, documents] = await Promise.all([
      this.listFolders(chapterId, userId),
      result.document_ids.length > 0
        ? this.documentRepo
            .findByIds(result.document_ids, chapterId)
            .then((docs) => this.visibleTo(chapterId, userId, docs))
        : Promise.resolve([]),
    ]);
    const seenFolders = new Set(folders.map((folder) => folder.id));
    const seenDocuments = new Set(documents.map((doc) => doc.id));
    return {
      folder_ids: result.folder_ids.filter((id) => seenFolders.has(id)),
      document_ids: result.document_ids.filter((id) => seenDocuments.has(id)),
    };
  }

  /**
   * Stars or unstars a folder for the caller alone. Starring reads the folder
   * through the chapter-scoped lookup first, which is what keeps a star from
   * naming another chapter's folder. Unstarring needs no read: it deletes
   * only the caller's own row in this chapter, and a missing one is a no-op.
   */
  async setFolderStarred(
    userId: string,
    chapterId: string,
    folderId: string,
    starred: boolean,
  ): Promise<void> {
    if (!starred) {
      await this.starRepo.remove(userId, chapterId, { folder_id: folderId });
      return;
    }
    await this.visibleFolder(folderId, chapterId, userId);
    await this.addStar(userId, chapterId, { folder_id: folderId }, 'Folder');
  }

  /** Stars or unstars a document for the caller alone, as folders star. */
  async setDocumentStarred(
    userId: string,
    chapterId: string,
    documentId: string,
    starred: boolean,
  ): Promise<void> {
    if (!starred) {
      await this.starRepo.remove(userId, chapterId, {
        document_id: documentId,
      });
      return;
    }
    await this.visibleDocument(documentId, chapterId, userId);
    await this.addStar(
      userId,
      chapterId,
      { document_id: documentId },
      'Document',
    );
  }

  /**
   * The insert behind both stars. The target was read in this chapter just
   * before, but an officer can delete it in between; the star's foreign key
   * then refuses the row, which is the same answer as a target never there.
   */
  private async addStar(
    userId: string,
    chapterId: string,
    target: ChapterDocumentStarTarget,
    noun: 'Folder' | 'Document',
  ): Promise<void> {
    try {
      await this.starRepo.add(userId, chapterId, target);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new NotFoundException(`${noun} not found`);
      }
      throw error;
    }
  }

  /** The chapter's folder named `name`, made if it is missing. */
  async ensureFolder(
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
function normalizeFolderName(folder: string | null | undefined): string | null {
  if (folder === null || folder === undefined) return null;
  const trimmed = folder.trim();
  return trimmed === '' ? null : trimmed;
}
