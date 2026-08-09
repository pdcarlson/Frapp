import type { ChapterDocumentFolder } from '../entities/chapter-document.entity';

export const CHAPTER_DOCUMENT_FOLDER_REPOSITORY =
  'CHAPTER_DOCUMENT_FOLDER_REPOSITORY';

export interface ChapterDocumentFolderUpdate {
  name?: string;
  sort_order?: number;
}

export interface IChapterDocumentFolderRepository {
  findByChapter(chapterId: string): Promise<ChapterDocumentFolder[]>;
  findById(
    id: string,
    chapterId: string,
  ): Promise<ChapterDocumentFolder | null>;
  findByName(
    name: string,
    chapterId: string,
  ): Promise<ChapterDocumentFolder | null>;
  create(data: {
    chapter_id: string;
    name: string;
    sort_order: number;
  }): Promise<ChapterDocumentFolder>;
  update(
    id: string,
    chapterId: string,
    data: ChapterDocumentFolderUpdate,
  ): Promise<ChapterDocumentFolder>;
  delete(id: string, chapterId: string): Promise<void>;
}
