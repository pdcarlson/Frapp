import { Inject, Injectable } from '@nestjs/common';
import {
  CHAPTER_DIRECTORY_REPOSITORY,
  type IChapterDirectoryRepository,
} from '#domain/repositories/chapter-directory.repository.interface';

const SEARCH_LIMIT = 20;

@Injectable()
export class ChapterDirectoryService {
  constructor(
    @Inject(CHAPTER_DIRECTORY_REPOSITORY)
    private readonly directoryRepo: IChapterDirectoryRepository,
  ) {}

  async search(q: string, university?: string) {
    return this.directoryRepo.search(q, university, SEARCH_LIMIT);
  }
}
