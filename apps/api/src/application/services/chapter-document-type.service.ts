import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DOCUMENT_TYPES_MAX } from '@repo/validation';
import {
  CHAPTER_DOCUMENT_TYPE_REPOSITORY,
  type IChapterDocumentTypeRepository,
} from '#domain/repositories/chapter-document-type.repository.interface';
import {
  CHAPTER_DOCUMENT_REPOSITORY,
  type IChapterDocumentRepository,
} from '#domain/repositories/chapter-document.repository.interface';
import type { ChapterDocumentType } from '#domain/entities/chapter-document.entity';

/**
 * A chapter's document types (#3642 piece 4,
 * `spec/behavior/chapter-docs.md` § Document types).
 *
 * A document stores its type's *name*, as it stores its folder's, so a rename
 * renames the type on its documents and a delete clears it from them. Names
 * are matched ignoring case: "bylaws" on an upload files as the chapter's
 * "Bylaws", which is what keeps the near-duplicates of the free-text era from
 * coming back.
 */
@Injectable()
export class ChapterDocumentTypeService {
  constructor(
    @Inject(CHAPTER_DOCUMENT_TYPE_REPOSITORY)
    private readonly typeRepo: IChapterDocumentTypeRepository,
    @Inject(CHAPTER_DOCUMENT_REPOSITORY)
    private readonly documentRepo: IChapterDocumentRepository,
  ) {}

  list(chapterId: string): Promise<ChapterDocumentType[]> {
    return this.typeRepo.findByChapter(chapterId);
  }

  /** Adds a type, at the end of the list unless a position is given. */
  async create(
    chapterId: string,
    name: string,
    sortOrder?: number,
  ): Promise<ChapterDocumentType> {
    const typeName = normalizeTypeName(name);
    if (typeName === null) {
      throw new BadRequestException('Type name must not be empty');
    }
    const existing = await this.typeRepo.findByChapter(chapterId);
    if (existing.some((type) => sameType(type.name, typeName))) {
      throw this.nameTaken(typeName);
    }
    if (existing.length >= DOCUMENT_TYPES_MAX) {
      throw new BadRequestException(
        `A chapter can have at most ${DOCUMENT_TYPES_MAX} document types`,
      );
    }
    const created = await this.typeRepo.create({
      chapter_id: chapterId,
      name: typeName,
      sort_order: sortOrder ?? nextSortOrder(existing),
    });
    // The read above is advisory; the unique index is the arbiter when two
    // creates race.
    if (!created) throw this.nameTaken(typeName);
    return created;
  }

  /** Renames or moves a type. A rename renames it on its documents. */
  async update(
    id: string,
    chapterId: string,
    changes: { name?: string; sort_order?: number },
  ): Promise<ChapterDocumentType> {
    const type = await this.typeRepo.findById(id, chapterId);
    if (!type) throw new NotFoundException('Document type not found');

    const rename =
      changes.name !== undefined ? normalizeTypeName(changes.name) : undefined;
    if (rename === null) {
      throw new BadRequestException('Type name must not be empty');
    }
    const isRename = rename !== undefined && rename !== type.name;
    if (isRename && !sameType(rename, type.name)) {
      const conflict = await this.typeRepo.findByName(chapterId, rename);
      if (conflict) throw this.nameTaken(rename);
    }

    const patch = {
      ...(isRename ? { name: rename } : {}),
      ...(changes.sort_order !== undefined
        ? { sort_order: changes.sort_order }
        : {}),
    };
    // Every field is optional, so `{}` is a valid body; an empty update would
    // match no row.
    if (Object.keys(patch).length === 0) return type;

    // Documents first, as a folder rename does: if the second write fails the
    // type row still has its old name, so retrying the same rename re-runs
    // both and converges.
    if (isRename) {
      await this.documentRepo.renameType(type.name, rename, chapterId);
    }
    const updated = await this.typeRepo.update(id, chapterId, patch);
    if (updated === undefined) {
      throw new NotFoundException('Document type not found');
    }
    if (updated === null) throw this.nameTaken(rename ?? type.name);
    return updated;
  }

  /** Deletes a type; its documents keep everything but the type. */
  async delete(id: string, chapterId: string): Promise<void> {
    const type = await this.typeRepo.findById(id, chapterId);
    if (!type) throw new NotFoundException('Document type not found');
    await this.documentRepo.clearType(type.name, chapterId);
    await this.typeRepo.delete(id, chapterId);
  }

  /**
   * The name an upload's type is stored under: the chapter's own spelling of
   * it, adding it to the list when the chapter has no such type yet (as an
   * upload into an unknown folder registers the folder). Null for no type.
   * Refused only when the name is new and the list is full.
   */
  async resolveForUpload(
    chapterId: string,
    name: string | null | undefined,
  ): Promise<string | null> {
    const typeName = normalizeTypeName(name);
    if (typeName === null) return null;
    const existing = await this.typeRepo.findByName(chapterId, typeName);
    if (existing) return existing.name;

    const all = await this.typeRepo.findByChapter(chapterId);
    if (all.length >= DOCUMENT_TYPES_MAX) {
      throw new BadRequestException(
        `This chapter already has ${DOCUMENT_TYPES_MAX} document types. Pick one of them, or ask an officer to remove one.`,
      );
    }
    const created = await this.typeRepo.create({
      chapter_id: chapterId,
      name: typeName,
      sort_order: nextSortOrder(all),
    });
    if (created) return created.name;
    // Another upload added the same new type a moment ago; use its row.
    const raced = await this.typeRepo.findByName(chapterId, typeName);
    if (raced) return raced.name;
    throw this.nameTaken(typeName);
  }

  private nameTaken(name: string): ConflictException {
    return new ConflictException(
      `This chapter already has a document type named "${name}"`,
    );
  }
}

/**
 * Trims a type name and collapses inner runs of whitespace; empty is `null`
 * (no type).
 */
export function normalizeTypeName(
  name: string | null | undefined,
): string | null {
  if (name === null || name === undefined) return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

function sameType(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function nextSortOrder(types: readonly ChapterDocumentType[]): number {
  if (types.length === 0) return 0;
  return Math.max(...types.map((t) => t.sort_order)) + 1;
}
