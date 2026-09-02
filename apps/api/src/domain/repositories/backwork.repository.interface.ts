import {
  BackworkResource,
  BackworkDepartment,
  BackworkProfessor,
} from '../entities/backwork.entity';

export const BACKWORK_RESOURCE_REPOSITORY = 'BACKWORK_RESOURCE_REPOSITORY';
export const BACKWORK_DEPARTMENT_REPOSITORY = 'BACKWORK_DEPARTMENT_REPOSITORY';
export const BACKWORK_PROFESSOR_REPOSITORY = 'BACKWORK_PROFESSOR_REPOSITORY';

export interface BackworkResourceFilter {
  department_id?: string;
  professor_id?: string;
  course_number?: string;
  year?: number;
  semester?: string;
  assignment_type?: string;
  document_variant?: string;
  search?: string;
}

export interface IBackworkResourceRepository {
  findById(id: string, chapterId: string): Promise<BackworkResource | null>;
  findByChapter(
    chapterId: string,
    filters?: BackworkResourceFilter,
  ): Promise<BackworkResource[]>;
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
