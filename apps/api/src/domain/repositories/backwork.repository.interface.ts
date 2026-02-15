import {
  BackworkCourse,
  BackworkProfessor,
  BackworkResource,
} from '../entities/backwork.entity';

export const BACKWORK_REPOSITORY = 'BACKWORK_REPOSITORY';

export interface IBackworkRepository {
  // Courses
  findCourseByCode(
    chapterId: string,
    code: string,
  ): Promise<BackworkCourse | null>;
  createCourse(
    course: Omit<BackworkCourse, 'id' | 'createdAt'>,
  ): Promise<BackworkCourse>;

  // Professors
  findProfessorByName(
    chapterId: string,
    name: string,
  ): Promise<BackworkProfessor | null>;
  createProfessor(
    professor: Omit<BackworkProfessor, 'id' | 'createdAt'>,
  ): Promise<BackworkProfessor>;

  // Resources
  createResource(
    resource: Omit<BackworkResource, 'id' | 'createdAt'>,
  ): Promise<BackworkResource>;
  findResourceByHash(
    chapterId: string,
    courseId: string,
    term: string,
    fileHash: string,
  ): Promise<BackworkResource | null>;
  findById(id: string): Promise<BackworkResource | null>;
  findByChapter(chapterId: string): Promise<BackworkResource[]>;
}
