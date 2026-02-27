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
}

export interface IBackworkDepartmentRepository {
  findByChapter(chapterId: string): Promise<BackworkDepartment[]>;
  findByCode(
    chapterId: string,
    code: string,
  ): Promise<BackworkDepartment | null>;
  create(data: Partial<BackworkDepartment>): Promise<BackworkDepartment>;
  update(
    id: string,
    data: Partial<BackworkDepartment>,
  ): Promise<BackworkDepartment>;
}

export interface IBackworkProfessorRepository {
  findByChapter(chapterId: string): Promise<BackworkProfessor[]>;
  findByName(
    chapterId: string,
    name: string,
  ): Promise<BackworkProfessor | null>;
  create(data: Partial<BackworkProfessor>): Promise<BackworkProfessor>;
}
