import {
  BackworkResource,
  BackworkDepartment,
  BackworkProfessor,
  BackworkCourse,
} from '../entities/backwork.entity';

export const BACKWORK_RESOURCE_REPOSITORY = 'BACKWORK_RESOURCE_REPOSITORY';
export const BACKWORK_DEPARTMENT_REPOSITORY = 'BACKWORK_DEPARTMENT_REPOSITORY';
export const BACKWORK_PROFESSOR_REPOSITORY = 'BACKWORK_PROFESSOR_REPOSITORY';
export const BACKWORK_COURSE_REPOSITORY = 'BACKWORK_COURSE_REPOSITORY';

export interface BackworkResourceFilter {
  department_id?: string;
  professor_id?: string;
  course_number?: string;
  year?: number;
  semester?: string;
  assignment_type?: string;
  document_variant?: string;
  search?: string;
  /** Only resources this member uploaded. Set by the API, never from a query string. */
  uploader_id?: string;
}

export interface IBackworkResourceRepository {
  findById(id: string, chapterId: string): Promise<BackworkResource | null>;
  findByChapter(
    chapterId: string,
    filters?: BackworkResourceFilter,
  ): Promise<BackworkResource[]>;
  /** Chapter-scoped: an id from another chapter is simply not returned. */
  findByIds(ids: string[], chapterId: string): Promise<BackworkResource[]>;
  findByFileHash(
    chapterId: string,
    fileHash: string,
  ): Promise<BackworkResource | null>;
  create(data: Partial<BackworkResource>): Promise<BackworkResource>;
  delete(id: string, chapterId: string): Promise<void>;
  /** Count of resources still tagged with this department, for the delete guard. */
  countByDepartment(chapterId: string, departmentId: string): Promise<number>;
  /** Count of resources still tagged with this professor, for the delete guard. */
  countByProfessor(chapterId: string, professorId: string): Promise<number>;
  /** Reassigns every resource tagged `fromId` to `toId`. Returns the count moved. */
  reassignDepartment(
    chapterId: string,
    fromId: string,
    toId: string,
  ): Promise<number>;
  /** Reassigns every resource tagged `fromId` to `toId`. Returns the count moved. */
  reassignProfessor(
    chapterId: string,
    fromId: string,
    toId: string,
  ): Promise<number>;
}

export interface IBackworkDepartmentRepository {
  findByChapter(chapterId: string): Promise<BackworkDepartment[]>;
  findByCode(
    chapterId: string,
    code: string,
  ): Promise<BackworkDepartment | null>;
  /** Chapter-scoped; resolves to `null` when no department in `chapterId` has `id`. */
  findById(id: string, chapterId: string): Promise<BackworkDepartment | null>;
  create(data: Partial<BackworkDepartment>): Promise<BackworkDepartment>;
  /** Chapter-scoped; resolves to `null` when no department in `chapterId` has `id`. */
  update(
    id: string,
    chapterId: string,
    data: Partial<BackworkDepartment>,
  ): Promise<BackworkDepartment | null>;
  delete(id: string, chapterId: string): Promise<void>;
}

export interface IBackworkProfessorRepository {
  findByChapter(chapterId: string): Promise<BackworkProfessor[]>;
  findByName(
    chapterId: string,
    name: string,
  ): Promise<BackworkProfessor | null>;
  /** Chapter-scoped; resolves to `null` when no professor in `chapterId` has `id`. */
  findById(id: string, chapterId: string): Promise<BackworkProfessor | null>;
  create(data: Partial<BackworkProfessor>): Promise<BackworkProfessor>;
  /** Chapter-scoped; resolves to `null` when no professor in `chapterId` has `id`. */
  update(
    id: string,
    chapterId: string,
    data: Partial<BackworkProfessor>,
  ): Promise<BackworkProfessor | null>;
  delete(id: string, chapterId: string): Promise<void>;
}

/**
 * One write to a course's name and nicknames. `name` applies only when
 * `setName`; with `mayRename` false it only fills an empty name. Nicknames:
 * stored minus `remove` (case-insensitive), plus `add`, de-duplicated.
 */
export interface BackworkCourseWrite {
  departmentId: string;
  courseNumber: string;
  setName: boolean;
  name: string | null;
  mayRename: boolean;
  add: string[];
  remove: string[];
  /**
   * For a department merge, which must not fail on the table's limits: drop
   * any nickname over 60 characters and keep the first 20, stored first.
   */
  clamp?: boolean;
}

export interface IBackworkCourseRepository {
  findByChapter(chapterId: string): Promise<BackworkCourse[]>;
  /** Every course of one department, for the department merge. */
  findByDepartment(
    chapterId: string,
    departmentId: string,
  ): Promise<BackworkCourse[]>;
  /**
   * The course with this department and number, the number compared trimmed
   * and case-insensitively; `null` when none is named yet.
   */
  findByCourse(
    chapterId: string,
    departmentId: string,
    courseNumber: string,
  ): Promise<BackworkCourse | null>;
  /** Chapter-scoped; resolves to `null` when no course in `chapterId` has `id`. */
  findById(id: string, chapterId: string): Promise<BackworkCourse | null>;
  /**
   * Creates or edits a course's entry in one statement (the database's
   * `backwork_course_write`), applied to the row as it is when it runs.
   * Resolves to `null` when the department isn't in `chapterId`.
   */
  write(
    chapterId: string,
    edit: BackworkCourseWrite,
  ): Promise<BackworkCourse | null>;
  delete(id: string, chapterId: string): Promise<void>;
}
