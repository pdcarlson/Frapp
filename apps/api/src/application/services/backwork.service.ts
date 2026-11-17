import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_BACKWORK_UPLOAD_BYTES,
  MAX_BACKWORK_UPLOAD_LABEL,
  MAX_COURSE_NICKNAMES,
  collapseCourseText,
  courseTextTooLong,
  departmentCodeKey,
  isUnredactedStudentCopy,
  normalizeCourseNicknames,
} from '@repo/validation';
import {
  BACKWORK_RESOURCE_REPOSITORY,
  BACKWORK_DEPARTMENT_REPOSITORY,
  BACKWORK_PROFESSOR_REPOSITORY,
  BACKWORK_COURSE_REPOSITORY,
  type BackworkCourseWrite,
  type BackworkPublishedColumns,
  type BackworkResourceFilter,
} from '#domain/repositories/backwork.repository.interface';
import type {
  IBackworkResourceRepository,
  IBackworkDepartmentRepository,
  IBackworkProfessorRepository,
  IBackworkCourseRepository,
} from '#domain/repositories/backwork.repository.interface';
import type {
  BackworkDraftFields,
  BackworkResource,
  BackworkDepartment,
  BackworkProfessor,
  BackworkCourse,
  Semester,
  AssignmentType,
  DocumentVariant,
} from '#domain/entities/backwork.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import { safeObjectFilename, storedFilename } from '#domain/constants/storage';
import { hasValue } from '#domain/utils/backwork-fill';
import { assertUploadedPathUnder } from './chapter-upload';
import {
  applyNicknameEdit,
  courseEditRefusal,
} from '#domain/utils/backwork-course-rules';

const BACKWORK_BUCKET = 'backwork';

/** Long enough to fetch 50 files one after another on a slow connection. */
const ZIP_LINK_TTL_SECONDS = 15 * 60;

export interface RequestUploadUrlInput {
  chapterId: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
}

export interface UpsertCourseInput {
  department_id: string;
  course_number: string;
  /** Omitted keeps the stored name; `null` or blank clears it (admin only). */
  name?: string | null;
  /** Nicknames to add; applied in SQL to the row as the write finds it. */
  add_nicknames?: string[];
  /** Nicknames to remove, case-insensitively, before the adds (admin only). */
  remove_nicknames?: string[];
}

/**
 * A document's metadata, as the confirm body and a draft carry it. Every field
 * is optional, so a draft can be saved before any of it is known.
 */
export interface BackworkFieldsInput {
  title?: string | null;
  department_code?: string | null;
  course_number?: string | null;
  /**
   * The course's name, from the upload sheet. Saved only when the course has
   * no name yet: an upload never renames a course.
   */
  course_name?: string | null;
  professor_name?: string | null;
  year?: number | null;
  semester?: string | null;
  assignment_type?: string | null;
  assignment_number?: number | null;
  document_variant?: string | null;
  tags?: string[] | null;
}

const DRAFT_FIELD_KEYS = [
  'title',
  'department_code',
  'course_number',
  'course_name',
  'professor_name',
  'year',
  'semester',
  'assignment_type',
  'assignment_number',
  'document_variant',
  'tags',
] as const satisfies ReadonlyArray<keyof BackworkFieldsInput>;

export interface ConfirmUploadInput extends BackworkFieldsInput {
  chapter_id: string;
  uploader_id: string;
  storage_path: string;
  file_hash: string;
  is_redacted?: boolean;
  /**
   * For a draft: false when it was saved without anyone looking at its
   * pages (#5252), so it waits for the uploader's check.
   */
  pages_checked?: boolean;
  /**
   * Save as a draft (#5208): the fields are kept as typed, not filed, and the
   * row is visible only to the uploader until it is published.
   */
  draft?: boolean;
}

export interface PublishDraftsResult {
  published: BackworkResource[];
  failed: Array<{ id: string; message: string }>;
}

/**
 * Why a document can't be filed as it stands, or null. A Student Copy must
 * have been flattened: its original carries a student's name, and only the
 * browser can redact it (spec § PDF Redaction). The web forms already refuse
 * this; the API holds the line for a draft whose copy type is changed after
 * upload.
 */
function fileRefusal(
  fields: BackworkFieldsInput,
  isRedacted: boolean,
): string | null {
  if (isUnredactedStudentCopy(fields.document_variant, isRedacted)) {
    return 'A Student Copy has to be redacted. This file was uploaded as-is, so pick another copy type or upload it again through bulk upload.';
  }
  return null;
}

/** Department and professor ids already resolved in one publish call. */
type TaxonomyLookups = {
  departments: Map<string, Promise<string | null>>;
  professors: Map<string, Promise<string | null>>;
};

/** `load()` once per key when there is a cache; a failed load isn't kept. */
function memo(
  cache: Map<string, Promise<string | null>> | undefined,
  key: string,
  load: () => Promise<string | null>,
): Promise<string | null> {
  if (!cache) return load();
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = load();
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
}

/** The keys a caller set, with blanks and undefined dropped. */
function draftFieldsFrom(input: BackworkFieldsInput): BackworkDraftFields {
  const out: Record<string, unknown> = {};
  for (const key of DRAFT_FIELD_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** How long the link a draft's pages are read from stays good. */
const DRAFT_FILE_URL_SECONDS = 300;

/**
 * How long an AI fill's claim on a draft holds before another fill may take
 * it over. Well past a real fill (one download of at most 25 MB, a text read
 * and one model call), so it only matters when a fill was cut off by a
 * restart and never released its claim. A fill gives up a minute before it
 * (`AI_FILL_TIME_LIMIT_MS` in `backwork-fill.service.ts`), so a takeover never
 * runs beside a fill that is still going.
 */
export const AI_FILL_CLAIM_STALE_MS = 5 * 60_000;

@Injectable()
export class BackworkService {
  private readonly logger = new Logger(BackworkService.name);

  constructor(
    @Inject(BACKWORK_RESOURCE_REPOSITORY)
    private readonly resourceRepo: IBackworkResourceRepository,
    @Inject(BACKWORK_DEPARTMENT_REPOSITORY)
    private readonly departmentRepo: IBackworkDepartmentRepository,
    @Inject(BACKWORK_PROFESSOR_REPOSITORY)
    private readonly professorRepo: IBackworkProfessorRepository,
    @Inject(BACKWORK_COURSE_REPOSITORY)
    private readonly courseRepo: IBackworkCourseRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  async requestUploadUrl(input: RequestUploadUrlInput) {
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!isAllowedUploadExtension('document', ext)) {
      throw new BadRequestException(`File extension "${ext}" is not allowed`);
    }

    if (!isAllowedUploadMime('document', input.contentType)) {
      throw new BadRequestException(
        `Content type "${input.contentType}" is not allowed`,
      );
    }

    if (
      input.sizeBytes !== undefined &&
      !isWithinUploadSizeLimit(input.sizeBytes, MAX_BACKWORK_UPLOAD_BYTES)
    ) {
      throw new BadRequestException(
        `File exceeds the ${MAX_BACKWORK_UPLOAD_LABEL} upload limit`,
      );
    }

    const resourceId = crypto.randomUUID();
    const storagePath = `chapters/${input.chapterId}/backwork/${resourceId}/${safeObjectFilename(input.filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      BACKWORK_BUCKET,
      storagePath,
      input.contentType,
    );

    return { signedUrl, storagePath, resourceId };
  }

  /**
   * A path a client names for a new row's file: inside the chapter's folder
   * with no way out of it, naming a file that was actually uploaded, and not
   * already another row's file. Without the last check a member could point
   * a draft at a published resource's object (every path is in the library
   * list) and then delete it by deleting the draft. Without the upload check
   * a row could name a file that never arrived, and every later read of it
   * would fail.
   */
  private async assertUnusedStoragePath(
    chapterId: string,
    storagePath: string,
  ) {
    await assertUploadedPathUnder(
      this.storageProvider,
      BACKWORK_BUCKET,
      `chapters/${chapterId}/backwork/`,
      storagePath,
      {
        field: 'storage_path',
        outsidePrefix:
          'storage_path must be within the chapter backwork folder',
        missing:
          "We couldn't find the uploaded file. Upload it again, then save it.",
      },
    );
    if (
      (await this.resourceRepo.countByStoragePath(chapterId, storagePath)) > 0
    ) {
      throw new ConflictException(
        'storage_path is already in use; request a new upload URL',
      );
    }
  }

  /**
   * Deletes a file a row no longer points at, unless another row still does,
   * and only logs when storage refuses: the row change already stands.
   */
  private async deleteFileIfUnused(
    chapterId: string,
    storagePath: string,
    context: string,
  ) {
    try {
      if (
        (await this.resourceRepo.countByStoragePath(chapterId, storagePath)) > 0
      ) {
        this.logger.warn(
          `${context}: kept ${storagePath}, another backwork row still uses it`,
        );
        return;
      }
      await this.storageProvider.deleteFile(BACKWORK_BUCKET, storagePath);
    } catch (error) {
      this.logger.warn(
        `${context}: couldn't delete ${storagePath}: ${(error as Error)?.message ?? String(error)}`,
      );
    }
  }

  async confirmUpload(input: ConfirmUploadInput): Promise<BackworkResource> {
    await this.assertUnusedStoragePath(input.chapter_id, input.storage_path);

    const existing = await this.resourceRepo.findByFileHash(
      input.chapter_id,
      input.file_hash,
    );
    if (existing) {
      // A draft is invisible to everyone but its uploader, so a 409 for one
      // says so instead of pointing at a library that doesn't show it.
      const message = !existing.draft_fields
        ? 'A file with the same hash already exists in this chapter'
        : existing.uploader_id === input.uploader_id
          ? 'This file is already in your drafts.'
          : 'Someone in your chapter already saved this file as a draft.';
      throw new ConflictException({
        message,
        existingResourceId: existing.id,
      });
    }

    if (input.draft) {
      return this.resourceRepo.create({
        chapter_id: input.chapter_id,
        uploader_id: input.uploader_id,
        storage_path: input.storage_path,
        file_hash: input.file_hash,
        is_redacted: input.is_redacted ?? false,
        draft_fields: {
          ...draftFieldsFrom(input),
          ...(input.pages_checked === false ? { pages_unchecked: true } : {}),
        },
      });
    }

    const isRedacted = input.is_redacted ?? false;
    const refusal = fileRefusal(input, isRedacted);
    if (refusal) throw new BadRequestException(refusal);

    const columns = await this.resolveColumns(input.chapter_id, input);
    const created = await this.resourceRepo.create({
      chapter_id: input.chapter_id,
      uploader_id: input.uploader_id,
      storage_path: input.storage_path,
      file_hash: input.file_hash,
      ...columns,
      is_redacted: isRedacted,
    });
    await this.nameCourseAfterFiling(input.chapter_id, columns, input, created);
    return created;
  }

  /** The caller's drafts in this chapter, in upload order. */
  async findDrafts(
    chapterId: string,
    uploaderId: string,
  ): Promise<BackworkResource[]> {
    return this.resourceRepo.findDrafts(chapterId, uploaderId);
  }

  /**
   * Sets the given fields on each of the caller's drafts among `ids`, keeping
   * the rest of each draft as it was. A field sent as `null` or blank clears
   * it. Ids that aren't the caller's drafts are left out of the result.
   */
  async updateDrafts(
    chapterId: string,
    uploaderId: string,
    ids: string[],
    fields: BackworkFieldsInput,
  ): Promise<BackworkResource[]> {
    const drafts = await this.resourceRepo.findDraftsByIds(
      ids,
      chapterId,
      uploaderId,
    );
    const set = draftFieldsFrom(fields);
    const cleared = DRAFT_FIELD_KEYS.filter(
      (key) => key in fields && fields[key] !== undefined && !(key in set),
    );
    const updated: BackworkResource[] = [];
    for (const draft of drafts) {
      const next: Record<string, unknown> = {
        ...(draft.draft_fields ?? {}),
        ...set,
      };
      for (const key of cleared) delete next[key];
      // A value the uploader set or cleared is theirs now, not the AI's.
      const aiFilled = draft.draft_fields?.ai_filled;
      if (aiFilled) {
        const touched = new Set<string>([...Object.keys(set), ...cleared]);
        const left = aiFilled.filter((key) => !touched.has(key));
        if (left.length > 0) next.ai_filled = left;
        else delete next.ai_filled;
      }
      const row = await this.resourceRepo.updateDraftFields(
        draft.id,
        chapterId,
        uploaderId,
        next,
      );
      if (row) updated.push(row);
    }
    return updated;
  }

  /** One of the caller's drafts, or null when it isn't theirs or is gone. */
  async findOwnDraft(
    id: string,
    chapterId: string,
    uploaderId: string,
  ): Promise<BackworkResource | null> {
    const [draft] = await this.resourceRepo.findDraftsByIds(
      [id],
      chapterId,
      uploaderId,
    );
    return draft ?? null;
  }

  /**
   * A redacted draft's stored file, for the AI fill (#5233): the flattened
   * copy, whose text layer holds only the words outside its redaction boxes.
   * Refuses a draft uploaded as-is, whose stored file is the original, so
   * no caller can hand an unredacted file to a model by mistake. Null when
   * the file is gone.
   *
   * The stored size is read first, and a file over `maxBytes` comes back
   * `too_large` without being downloaded: a backwork upload may be up to
   * 100 MB, four times what the text extractor opens, and reading it into
   * memory only to skip it costs the server for nothing.
   */
  async redactedDraftFile(
    draft: BackworkResource,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array } | 'too_large' | null> {
    if (!draft.is_redacted) {
      throw new Error(`Backwork draft ${draft.id} was uploaded as-is`);
    }
    const folder = draft.storage_path.slice(
      0,
      draft.storage_path.lastIndexOf('/'),
    );
    const stored = (
      await this.storageProvider.listObjects(BACKWORK_BUCKET, folder)
    ).find((object) => object.path === draft.storage_path);
    if (!stored) return null;
    if (stored.sizeBytes === undefined) {
      // Storage always reports a size today; if that changes, the fill keeps
      // working and the extractor's own cap still applies after the download.
      this.logger.warn(
        `Backwork draft ${draft.id}: storage reported no size for its file`,
      );
    } else if (stored.sizeBytes > maxBytes) {
      return 'too_large';
    }
    const bytes = await this.storageProvider.downloadFile(
      BACKWORK_BUCKET,
      draft.storage_path,
    );
    return bytes ? { bytes } : null;
  }

  /**
   * Claims one of the caller's drafts for an AI fill, so only one fill reads
   * its file at a time, across every API instance. Returns a release to call
   * when the fill ends, or null when another fill holds the draft. A claim
   * older than `AI_FILL_CLAIM_STALE_MS` is taken over, so a fill cut off by a
   * restart never holds the draft for good.
   */
  async claimAiFill(
    id: string,
    chapterId: string,
    uploaderId: string,
    now: Date = new Date(),
  ): Promise<(() => Promise<void>) | null> {
    const claim = await this.resourceRepo.claimAiFill(
      id,
      chapterId,
      uploaderId,
      now,
      new Date(now.getTime() - AI_FILL_CLAIM_STALE_MS),
    );
    if (!claim) return null;
    return async () => {
      try {
        await this.resourceRepo.releaseAiFill(id, chapterId, claim);
      } catch (error) {
        // The claim goes stale on its own; a failed release only makes the
        // next fill of this draft wait for that.
        this.logger.warn(
          `Backwork draft ${id}: couldn't release its AI fill claim: ${(error as Error)?.message ?? String(error)}`,
        );
      }
    };
  }

  /**
   * Puts an AI fill on one of the caller's drafts. The draft is read again
   * here, so a field the uploader set while the model ran is kept: only
   * fields still empty take the fill's value. Null when the draft is gone.
   */
  async applyAiFill(
    id: string,
    chapterId: string,
    uploaderId: string,
    fill: {
      fields: BackworkDraftFields;
      outcome: NonNullable<BackworkDraftFields['ai_fill']>;
    },
  ): Promise<BackworkResource | null> {
    const [draft] = await this.resourceRepo.findDraftsByIds(
      [id],
      chapterId,
      uploaderId,
    );
    if (!draft) return null;
    const current = draft.draft_fields ?? {};
    const next: Record<string, unknown> = { ...current };
    const filled = new Set(current.ai_filled ?? []);
    for (const [key, value] of Object.entries(fill.fields)) {
      if (hasValue((current as Record<string, unknown>)[key])) continue;
      next[key] = value;
      filled.add(key);
    }
    if (filled.size > 0) next.ai_filled = [...filled];
    next.ai_fill = fill.outcome;
    return this.resourceRepo.updateDraftFields(id, chapterId, uploaderId, next);
  }

  /**
   * A short-lived link to one of the caller's drafts' stored file, so the
   * uploader's browser can show its pages for checking (#5252). Not a forced
   * download: the page reads it, nobody opens it.
   */
  async draftFileUrl(
    id: string,
    chapterId: string,
    uploaderId: string,
  ): Promise<string> {
    const draft = await this.findOwnDraft(id, chapterId, uploaderId);
    if (!draft) throw new NotFoundException('Draft not found');
    return this.storageProvider.getSignedDownloadUrl(
      BACKWORK_BUCKET,
      draft.storage_path,
      DRAFT_FILE_URL_SECONDS,
    );
  }

  /**
   * Records that the uploader has looked at a draft's pages (#5252), so the AI
   * fill may read it and it can be published. When they added boxes, the
   * browser flattened the file again and uploaded it to a new path, which
   * replaces the stored file here; the old object is deleted after the row
   * points away from it.
   */
  async checkDraft(
    id: string,
    chapterId: string,
    uploaderId: string,
    replacement?: { storage_path: string; file_hash: string },
  ): Promise<BackworkResource> {
    const draft = await this.findOwnDraft(id, chapterId, uploaderId);
    if (!draft) throw new NotFoundException('Draft not found');
    const rest: BackworkDraftFields = { ...draft.draft_fields };
    delete rest.pages_unchecked;
    if (!replacement) {
      const row = await this.resourceRepo.updateDraftFields(
        id,
        chapterId,
        uploaderId,
        rest,
      );
      if (!row) throw new NotFoundException('Draft not found');
      return row;
    }

    // Only a draft still waiting for its check takes a new file: the check
    // is the one flow that flattens the file again (#5252).
    if (!draft.draft_fields?.pages_unchecked) {
      throw new ConflictException("This draft's pages are already checked.");
    }
    await this.assertUnusedStoragePath(chapterId, replacement.storage_path);
    const existing = await this.resourceRepo.findByFileHash(
      chapterId,
      replacement.file_hash,
    );
    if (existing && existing.id !== id) {
      throw new ConflictException({
        message: 'A file with the same hash already exists in this chapter',
        existingResourceId: existing.id,
      });
    }
    // The new file has every box the old one had and more, so whatever an
    // earlier fill read is stale: it may read the file again.
    const fields: BackworkDraftFields = { ...rest };
    delete fields.ai_fill;
    const row = await this.resourceRepo.replaceDraftFile(
      id,
      chapterId,
      uploaderId,
      {
        storage_path: replacement.storage_path,
        file_hash: replacement.file_hash,
        is_redacted: true,
        draft_fields: fields,
      },
    );
    if (!row) throw new NotFoundException('Draft not found');
    await this.deleteFileIfUnused(
      chapterId,
      draft.storage_path,
      `Replaced backwork draft ${id}'s file`,
    );
    return row;
  }

  /**
   * Files each of the caller's drafts among `ids` the way a confirm would:
   * departments and professors resolved or created, the course named if it
   * had no name. One draft that can't be filed doesn't stop the rest; it is
   * reported in `failed` and stays a draft. An id that isn't the caller's
   * draft (already published, deleted, someone else's) is reported too.
   */
  async publishDrafts(
    chapterId: string,
    uploaderId: string,
    ids: string[],
  ): Promise<PublishDraftsResult> {
    const drafts = await this.resourceRepo.findDraftsByIds(
      ids,
      chapterId,
      uploaderId,
    );
    const byId = new Map(drafts.map((draft) => [draft.id, draft]));
    const result: PublishDraftsResult = { published: [], failed: [] };
    // A batch nearly always shares a department and a professor: look each
    // up once, not once per draft.
    const lookups: TaxonomyLookups = {
      departments: new Map(),
      professors: new Map(),
    };
    for (const id of ids) {
      const draft = byId.get(id);
      if (!draft) {
        result.failed.push({ id, message: 'This draft is no longer here.' });
        continue;
      }
      const fields = (draft.draft_fields ?? {}) as BackworkFieldsInput;
      const refusal = draft.draft_fields?.pages_unchecked
        ? 'Check its pages before you publish it.'
        : fileRefusal(fields, draft.is_redacted);
      if (refusal) {
        result.failed.push({ id, message: refusal });
        continue;
      }
      try {
        const columns = await this.resolveColumns(chapterId, fields, lookups);
        const row = await this.resourceRepo.publishDraft(
          id,
          chapterId,
          uploaderId,
          columns,
        );
        if (!row) {
          result.failed.push({ id, message: 'This draft is no longer here.' });
          continue;
        }
        await this.nameCourseAfterFiling(chapterId, columns, fields, row);
        result.published.push(row);
      } catch (error) {
        this.logger.warn(
          `Couldn't publish backwork draft ${id} for chapter ${chapterId}: ${(error as Error)?.message ?? String(error)}`,
        );
        result.failed.push({
          id,
          message: "Couldn't publish this one. Try again.",
        });
      }
    }
    return result;
  }

  /**
   * Deletes one of the caller's drafts and its file. The row goes first, so a
   * storage failure leaves an unreachable object rather than a row whose file
   * is gone (#3526).
   */
  async deleteDraft(
    id: string,
    chapterId: string,
    uploaderId: string,
  ): Promise<void> {
    const [draft] = await this.resourceRepo.findDraftsByIds(
      [id],
      chapterId,
      uploaderId,
    );
    if (!draft) throw new NotFoundException('Draft not found');
    const deleted = await this.resourceRepo.deleteDraft(
      id,
      chapterId,
      uploaderId,
    );
    if (!deleted) throw new NotFoundException('Draft not found');
    await this.deleteFileIfUnused(
      chapterId,
      draft.storage_path,
      `Deleted backwork draft ${id}`,
    );
  }

  /**
   * The filed columns for a document's fields: department and professor
   * resolved by name, or created. Shared by confirm and publish so both file
   * a document the same way.
   */
  private async resolveColumns(
    chapterId: string,
    fields: BackworkFieldsInput,
    lookups?: TaxonomyLookups,
  ): Promise<BackworkPublishedColumns> {
    let departmentId: string | null = null;
    const departmentCode = fields.department_code;
    if (departmentCode?.trim()) {
      departmentId = await memo(
        lookups?.departments,
        departmentCodeKey(departmentCode),
        () => this.resolveOrCreateDepartment(chapterId, departmentCode),
      );
    }

    let professorId: string | null = null;
    const professorName = fields.professor_name;
    if (professorName?.trim()) {
      professorId = await memo(lookups?.professors, professorName, () =>
        this.resolveOrCreateProfessor(chapterId, professorName),
      );
    }

    return {
      title: fields.title ?? null,
      department_id: departmentId,
      // Trimmed like the course key (`lower(btrim(course_number))`), so the
      // stored number and the course join agree.
      course_number: fields.course_number?.trim() || null,
      professor_id: professorId,
      year: fields.year ?? null,
      semester: (fields.semester as Semester) ?? null,
      assignment_type: (fields.assignment_type as AssignmentType) ?? null,
      assignment_number: fields.assignment_number ?? null,
      document_variant: (fields.document_variant as DocumentVariant) ?? null,
      tags: fields.tags ?? [],
    };
  }

  /**
   * Names the course from the form's "Course name" if it has none yet. Best
   * effort: the file is filed by now, and a course name that didn't save
   * must not report the upload as failed (the member would retry and hit the
   * duplicate-hash 409). It can be named from the row menu.
   */
  private async nameCourseAfterFiling(
    chapterId: string,
    columns: BackworkPublishedColumns,
    fields: BackworkFieldsInput,
    filed: BackworkResource,
  ): Promise<void> {
    const courseName = fields.course_name
      ? collapseCourseText(fields.course_name)
      : '';
    if (!columns.department_id || !columns.course_number || !courseName) {
      return;
    }
    try {
      await this.nameCourseIfUnnamed(
        chapterId,
        columns.department_id,
        columns.course_number,
        courseName,
      );
    } catch (error) {
      this.logger.warn(
        `Couldn't name course ${columns.course_number} (department ${columns.department_id}) for chapter ${chapterId} after upload ${filed.id}: ${(error as Error)?.message ?? String(error)}`,
      );
    }
  }

  /**
   * The resource with a signed link to its file, good for an hour. The link
   * forces a download saved under the stored filename, like every backwork
   * link the app hands out (#3867): nothing on `/backwork` previews a file,
   * so the app never opens one as a page. That is what the app does, not a
   * boundary: the `download` parameter sits outside the signature, so anyone
   * holding the link can drop it. The gate is the bucket's allowed types.
   */
  async findById(
    id: string,
    chapterId: string,
  ): Promise<BackworkResource & { downloadUrl: string }> {
    const resource = await this.resourceRepo.findById(id, chapterId);
    if (!resource) {
      throw new NotFoundException('Backwork resource not found');
    }

    const downloadUrl = await this.storageProvider.getSignedDownloadUrl(
      BACKWORK_BUCKET,
      resource.storage_path,
      undefined,
      storedFilename(resource.storage_path),
    );

    return { ...resource, downloadUrl };
  }

  /**
   * Signed links for the files a member zips on `/backwork`, in the order
   * asked. An id that isn't in this chapter, or whose object couldn't be
   * signed, is left out rather than failing the batch; the web client says
   * how many it couldn't add. The cap on how many ids one call takes lives
   * on the DTO (`MAX_BACKWORK_ZIP_FILES`).
   *
   * Forced downloads, like every link a member could open directly: the
   * bucket can't pin a content type (`IStorageProvider.getSignedDownloadUrls`).
   */
  async getDownloadUrls(
    ids: string[],
    chapterId: string,
  ): Promise<Array<{ id: string; download_url: string }>> {
    const resources = await this.resourceRepo.findByIds(ids, chapterId);
    if (resources.length === 0) return [];
    const signed = await this.storageProvider.getSignedDownloadUrls(
      BACKWORK_BUCKET,
      resources.map((resource) => resource.storage_path),
      ZIP_LINK_TTL_SECONDS,
      true,
    );
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    return ids.flatMap((id) => {
      const resource = byId.get(id);
      const url = resource ? signed[resource.storage_path] : undefined;
      return url ? [{ id, download_url: url }] : [];
    });
  }

  async findByChapter(
    chapterId: string,
    filters?: BackworkResourceFilter,
  ): Promise<BackworkResource[]> {
    return this.resourceRepo.findByChapter(chapterId, filters);
  }

  async delete(id: string, chapterId: string): Promise<void> {
    // Admins can delete drafts too: one a member left behind (they left the
    // chapter, or deleted their account) would otherwise hold its file hash
    // forever, since a re-upload of the same file counts as a duplicate.
    const resource = await this.resourceRepo.findById(id, chapterId, {
      includeDrafts: true,
    });
    if (!resource) {
      throw new NotFoundException('Backwork resource not found');
    }

    await this.storageProvider.deleteFile(
      BACKWORK_BUCKET,
      resource.storage_path,
    );
    await this.resourceRepo.delete(id, chapterId);
  }

  async getDepartments(chapterId: string): Promise<BackworkDepartment[]> {
    return this.departmentRepo.findByChapter(chapterId);
  }

  async updateDepartment(
    id: string,
    chapterId: string,
    data: { name?: string },
  ): Promise<BackworkDepartment> {
    // The repository scopes the write to the active chapter, so `null` means
    // the department is either gone or owned by another chapter. Both surface
    // as 404 — a `backwork:admin` must not be able to probe for the existence
    // of another chapter's departments by UUID.
    const updated = await this.departmentRepo.update(id, chapterId, data);
    if (!updated) {
      throw new NotFoundException('Department not found');
    }
    return updated;
  }

  async getProfessors(chapterId: string): Promise<BackworkProfessor[]> {
    return this.professorRepo.findByChapter(chapterId);
  }

  async updateProfessor(
    id: string,
    chapterId: string,
    data: { name?: string },
  ): Promise<BackworkProfessor> {
    const updated = await this.professorRepo.update(id, chapterId, data);
    if (!updated) {
      throw new NotFoundException('Professor not found');
    }
    return updated;
  }

  async getCourses(chapterId: string): Promise<BackworkCourse[]> {
    return this.courseRepo.findByChapter(chapterId);
  }

  /**
   * Names a course, or adds to its nicknames, creating its entry on first
   * write. `courseEditRefusal` decides what a non-admin may change; a refused
   * edit is a 403 and writes nothing.
   */
  async upsertCourse(
    chapterId: string,
    input: UpsertCourseInput,
    isAdmin: boolean,
  ): Promise<BackworkCourse> {
    const department = await this.departmentRepo.findById(
      input.department_id,
      chapterId,
    );
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    const courseNumber = input.course_number.trim();
    if (!courseNumber) {
      throw new BadRequestException('course_number must not be blank');
    }
    // Read only to answer a refused or impossible edit with a clear 403 or
    // 400; the write itself (`backwork_course_write`) applies the edit to the
    // row as it is when the statement runs, so it never overwrites a change
    // made since this read.
    const stored = await this.courseRepo.findByCourse(
      chapterId,
      department.id,
      courseNumber,
    );
    const setName = input.name !== undefined;
    const name = setName ? collapseCourseText(input.name ?? '') || null : null;
    const remove = (input.remove_nicknames ?? [])
      .map(collapseCourseText)
      .filter(Boolean);
    const add = normalizeCourseNicknames(input.add_nicknames ?? []);
    const refusal = courseEditRefusal(
      stored,
      {
        name: setName ? name : (stored?.name ?? null),
        removeNicknames: remove,
      },
      isAdmin,
    );
    if (refusal) throw new ForbiddenException(refusal);
    const tooLong = courseTextTooLong(name, add);
    if (tooLong) throw new BadRequestException(tooLong);
    const resultingName = !setName
      ? (stored?.name ?? null)
      : isAdmin
        ? name
        : (stored?.name ?? name);
    const predicted = applyNicknameEdit(
      stored?.nicknames ?? [],
      add,
      remove,
      resultingName,
    );
    if (predicted.length > MAX_COURSE_NICKNAMES) {
      throw new BadRequestException(
        `A course takes at most ${MAX_COURSE_NICKNAMES} nicknames`,
      );
    }
    if (!stored && !name && add.length === 0) {
      throw new BadRequestException('Give the course a name or a nickname');
    }
    const written = await this.writeCourse(chapterId, {
      departmentId: department.id,
      courseNumber,
      setName,
      name,
      mayRename: isAdmin,
      add,
      remove,
    });
    if (!written) throw new NotFoundException('Department not found');
    return written;
  }

  /** Deletes a course's name and nicknames (`backwork:admin`). Files keep their course. */
  async deleteCourse(id: string, chapterId: string): Promise<void> {
    const existing = await this.courseRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Course not found');
    }
    await this.courseRepo.delete(id, chapterId);
  }

  /**
   * Deletes a department, or a professor when `entity: 'professor'`. Blocks
   * with a 400 (rather than orphaning the taxonomy on every resource that
   * still references it, which the FK's `on delete set null` would otherwise
   * do silently) while any resource is still tagged with it — `mergeXxx`
   * below is the guided path to clear that first.
   */
  async deleteDepartment(id: string, chapterId: string): Promise<void> {
    const existing = await this.departmentRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Department not found');
    }
    const referenced = await this.resourceRepo.countByDepartment(chapterId, id);
    if (referenced > 0) {
      throw new BadRequestException(
        `Cannot delete: ${referenced} resource(s) still reference this department. Merge it into another department first.`,
      );
    }
    await this.departmentRepo.delete(id, chapterId);
  }

  async deleteProfessor(id: string, chapterId: string): Promise<void> {
    const existing = await this.professorRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Professor not found');
    }
    const referenced = await this.resourceRepo.countByProfessor(chapterId, id);
    if (referenced > 0) {
      throw new BadRequestException(
        `Cannot delete: ${referenced} resource(s) still reference this professor. Merge it into another professor first.`,
      );
    }
    await this.professorRepo.delete(id, chapterId);
  }

  /**
   * Merges a duplicate department into another: every resource tagged
   * `sourceId` is reassigned to `targetId`, then `sourceId` is deleted. Not
   * wrapped in a DB transaction — the reassign-then-delete order means the
   * only failure window is a resource created between the two calls, which
   * the FK's `on delete set null` degrades to a blank (not orphaned/broken)
   * department field on that one row, self-healing on the next re-tag. Lower
   * risk than the ledger-touching operations elsewhere in this codebase that
   * do need atomic RPCs.
   */
  async mergeDepartments(
    sourceId: string,
    targetId: string,
    chapterId: string,
  ): Promise<{ reassigned: number }> {
    if (sourceId === targetId) {
      throw new BadRequestException('Cannot merge a department into itself');
    }
    const [source, target] = await Promise.all([
      this.departmentRepo.findById(sourceId, chapterId),
      this.departmentRepo.findById(targetId, chapterId),
    ]);
    if (!source || !target) {
      throw new NotFoundException('Department not found');
    }
    // Courses first, so the source's names survive the delete below (its FK
    // cascades): each folds into the target's entry for the same course
    // number, created if the target has none.
    await this.foldCourses(chapterId, sourceId, targetId);
    const reassigned = await this.resourceRepo.reassignDepartment(
      chapterId,
      sourceId,
      targetId,
    );
    await this.departmentRepo.delete(sourceId, chapterId);
    return { reassigned };
  }

  async mergeProfessors(
    sourceId: string,
    targetId: string,
    chapterId: string,
  ): Promise<{ reassigned: number }> {
    if (sourceId === targetId) {
      throw new BadRequestException('Cannot merge a professor into itself');
    }
    const [source, target] = await Promise.all([
      this.professorRepo.findById(sourceId, chapterId),
      this.professorRepo.findById(targetId, chapterId),
    ]);
    if (!source || !target) {
      throw new NotFoundException('Professor not found');
    }
    const reassigned = await this.resourceRepo.reassignProfessor(
      chapterId,
      sourceId,
      targetId,
    );
    await this.professorRepo.delete(sourceId, chapterId);
    return { reassigned };
  }

  /**
   * Folds each of the source department's courses into the target, one
   * `backwork_course_write` per course, then deletes the source course. The
   * write is fill-only (the target keeps its name, or takes the source's when
   * it has none) and adds the source's nicknames and name as nicknames, so
   * what people typed keeps finding the course. Being an upsert, it merges
   * into a twin created a moment ago instead of colliding with it. `clamp`
   * keeps the fold from failing on the table's limits: it drops a nickname
   * over 60 characters (a long losing name) and keeps the first 20, the
   * target's own first.
   */
  private async foldCourses(
    chapterId: string,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    const sourceCourses = await this.courseRepo.findByDepartment(
      chapterId,
      sourceId,
    );
    for (const course of sourceCourses) {
      const written = await this.courseRepo.write(chapterId, {
        departmentId: targetId,
        courseNumber: course.course_number,
        setName: course.name !== null,
        name: course.name,
        mayRename: false,
        add: [...course.nicknames, ...(course.name ? [course.name] : [])],
        remove: [],
        clamp: true,
      });
      if (!written) throw new NotFoundException('Department not found');
      await this.courseRepo.delete(course.id, chapterId);
    }
  }

  /**
   * The upload sheet's "Course name": fill-only, in one statement, so it
   * never overwrites a name, even one saved a moment ago by someone else.
   */
  private async nameCourseIfUnnamed(
    chapterId: string,
    departmentId: string,
    courseNumber: string,
    name: string,
  ): Promise<void> {
    const tooLong = courseTextTooLong(name, []);
    if (tooLong) throw new BadRequestException(tooLong);
    await this.writeCourse(chapterId, {
      departmentId,
      courseNumber,
      setName: true,
      name,
      mayRename: false,
      add: [],
      remove: [],
    });
  }

  /**
   * `courseRepo.write`, with the table's check violation (`23514`) answered
   * as a 400: the limits above should catch every case first, and this keeps
   * one they miss from reaching the member as a 500.
   */
  private async writeCourse(
    chapterId: string,
    edit: BackworkCourseWrite,
  ): Promise<BackworkCourse | null> {
    try {
      return await this.courseRepo.write(chapterId, edit);
    } catch (error) {
      if ((error as { code?: string }).code === '23514') {
        throw new BadRequestException(
          'That name or nickname is too long, or there are too many nicknames',
        );
      }
      throw error;
    }
  }

  private async resolveOrCreateDepartment(
    chapterId: string,
    code: string,
  ): Promise<string> {
    // Matched trimmed and case-insensitively, and a new one stored that way
    // (`departmentCodeKey`, #3918), so "math" files under an existing "MATH"
    // rather than starting a second department.
    const existing = await this.departmentRepo.findByCode(chapterId, code);
    if (existing) return existing.id;

    try {
      const created = await this.departmentRepo.create({
        chapter_id: chapterId,
        code: departmentCodeKey(code),
      });
      return created.id;
    } catch (error) {
      // Another upload created it between the lookup and the insert (bulk
      // upload confirms two files at once, and "math" and "Math" now store
      // the same code): file under that one rather than failing the upload.
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.departmentRepo.findByCode(chapterId, code);
      if (!raced) throw error;
      return raced.id;
    }
  }

  private async resolveOrCreateProfessor(
    chapterId: string,
    name: string,
  ): Promise<string> {
    const existing = await this.professorRepo.findByName(chapterId, name);
    if (existing) return existing.id;

    const created = await this.professorRepo.create({
      chapter_id: chapterId,
      name,
    });
    return created.id;
  }
}
