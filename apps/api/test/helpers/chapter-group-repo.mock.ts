import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';

/** Every method a jest mock; reads answer "no groups" until a test says otherwise. */
export type ChapterGroupRepoMock = {
  [K in keyof IChapterGroupRepository]: jest.Mock;
};

/** A group repository with no groups (#4076), for services that read them. */
export function createChapterGroupRepoMock(): ChapterGroupRepoMock {
  return {
    findByChapter: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMemberships: jest.fn().mockResolvedValue([]),
    findGroupIdsForUser: jest.fn().mockResolvedValue([]),
    setMembers: jest.fn(),
  };
}
