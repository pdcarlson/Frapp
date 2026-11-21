import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DOCUMENT_TYPES_MAX, documentTypeKey } from '@repo/validation';
import {
  CHAPTER_DOCUMENT_TYPE_REPOSITORY,
  type IChapterDocumentTypeRepository,
} from '#domain/repositories/chapter-document-type.repository.interface';
import type { ChapterDocumentType } from '#domain/entities/chapter-document.entity';

/**
 * A chapter's document types (#3642 piece 4,
 * `spec/behavior/chapter-docs.md` § Document types).
 *
 * A document stores its type's *name*, as it stores its folder's, so a rename
 * renames the type on its documents and a delete clears it from them, each in
 * one transaction in the database. Names are matched by key
 * (`documentTypeKey`: case and everything but letters and digits ignored), so
 * "by-laws" on an upload files as the chapter's "Bylaws", which is what keeps
 * the near-duplicates of the free-text era from coming back.
 */
@Injectable()
export class ChapterDocumentTypeService {
  constructor(
    @Inject(CHAPTER_DOCUMENT_TYPE_REPOSITORY)
    private readonly typeRepo: IChapterDocumentTypeRepository,
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
    if (typeName === null) throw emptyName();
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
    if (rename === null) throw emptyName();

    let current = type;
    if (rename !== undefined && rename !== type.name) {
      // A friendlier answer than the unique index's, when the name is plainly
      // another type's; the database still decides a race.
      if (!sameType(rename, type.name)) {
        const conflict = await this.typeRepo.findByName(chapterId, rename);
        if (conflict) throw this.nameTaken(rename);
      }
      // The row and its documents change together or not at all
      // (`rename_chapter_document_type`).
      const renamed = await this.typeRepo.rename(chapterId, id, rename);
      if (renamed === undefined) {
        throw new NotFoundException('Document type not found');
      }
      if (renamed === null) throw this.nameTaken(rename);
      current = renamed;
    }
    if (
      changes.sort_order !== undefined &&
      changes.sort_order !== current.sort_order
    ) {
      const moved = await this.typeRepo.setSortOrder(
        id,
        chapterId,
        changes.sort_order,
      );
      if (!moved) throw new NotFoundException('Document type not found');
      current = moved;
    }
    return current;
  }

  /** Deletes a type; its documents keep everything but the type. */
  async delete(id: string, chapterId: string): Promise<void> {
    const deleted = await this.typeRepo.deleteWithDocuments(chapterId, id);
    if (!deleted) throw new NotFoundException('Document type not found');
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
 * Trims a type name and collapses inner runs of whitespace; a name with no
 * letter or digit is `null` (no type), since its key would be empty.
 */
export function normalizeTypeName(
  name: string | null | undefined,
): string | null {
  if (name === null || name === undefined) return null;
  const trimmed = name.trim().replace(/\s+/g, ' ');
  return documentTypeKey(trimmed) === '' ? null : trimmed;
}

function sameType(a: string, b: string): boolean {
  return documentTypeKey(a) === documentTypeKey(b);
}

function emptyName(): BadRequestException {
  return new BadRequestException(
    'A type name needs at least one letter or number',
  );
}

function nextSortOrder(types: readonly ChapterDocumentType[]): number {
  if (types.length === 0) return 0;
  return Math.max(...types.map((t) => t.sort_order)) + 1;
}
