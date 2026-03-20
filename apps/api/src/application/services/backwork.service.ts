import * as path from 'path';
import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  BACKWORK_RESOURCE_REPOSITORY,
  BACKWORK_DEPARTMENT_REPOSITORY,
  BACKWORK_PROFESSOR_REPOSITORY,
  type BackworkResourceFilter,
} from '../../domain/repositories/backwork.repository.interface';
import type {
  IBackworkResourceRepository,
  IBackworkDepartmentRepository,
  IBackworkProfessorRepository,
} from '../../domain/repositories/backwork.repository.interface';
import type {
  BackworkResource,
  BackworkDepartment,
  BackworkProfessor,
  Semester,
  AssignmentType,
  DocumentVariant,
} from '../../domain/entities/backwork.entity';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';

const BACKWORK_BUCKET = 'backwork';

export interface RequestUploadUrlInput {
  chapterId: string;
  filename: string;
  contentType: string;
}

export interface ConfirmUploadInput {
  chapter_id: string;
  uploader_id: string;
  storage_path: string;
  file_hash: string;
  title?: string | null;
  department_code?: string | null;
  course_number?: string | null;
  professor_name?: string | null;
  year?: number | null;
  semester?: string | null;
  assignment_type?: string | null;
  assignment_number?: number | null;
  document_variant?: string | null;
  tags?: string[];
  is_redacted?: boolean;
}

@Injectable()
export class BackworkService {
  constructor(
    @Inject(BACKWORK_RESOURCE_REPOSITORY)
    private readonly resourceRepo: IBackworkResourceRepository,
    @Inject(BACKWORK_DEPARTMENT_REPOSITORY)
    private readonly departmentRepo: IBackworkDepartmentRepository,
    @Inject(BACKWORK_PROFESSOR_REPOSITORY)
    private readonly professorRepo: IBackworkProfessorRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
  ) {}

  async requestUploadUrl(input: RequestUploadUrlInput) {
    const resourceId = crypto.randomUUID();
    const storagePath = `chapters/${input.chapterId}/backwork/${resourceId}/${path.basename(input.filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      BACKWORK_BUCKET,
      storagePath,
      input.contentType,
    );

    return { signedUrl, storagePath, resourceId };
  }

  async confirmUpload(input: ConfirmUploadInput): Promise<BackworkResource> {
    const existing = await this.resourceRepo.findByFileHash(
      input.chapter_id,
      input.file_hash,
    );
    if (existing) {
      throw new ConflictException({
        message: 'A file with the same hash already exists in this chapter',
        existingResourceId: existing.id,
      });
    }

    let departmentId: string | null = null;
    if (input.department_code) {
      departmentId = await this.resolveOrCreateDepartment(
        input.chapter_id,
        input.department_code,
      );
    }

    let professorId: string | null = null;
    if (input.professor_name) {
      professorId = await this.resolveOrCreateProfessor(
        input.chapter_id,
        input.professor_name,
      );
    }

    return this.resourceRepo.create({
      chapter_id: input.chapter_id,
      uploader_id: input.uploader_id,
      storage_path: input.storage_path,
      file_hash: input.file_hash,
      title: input.title ?? null,
      department_id: departmentId,
      course_number: input.course_number ?? null,
      professor_id: professorId,
      year: input.year ?? null,
      semester: (input.semester as Semester) ?? null,
      assignment_type: (input.assignment_type as AssignmentType) ?? null,
      assignment_number: input.assignment_number ?? null,
      document_variant: (input.document_variant as DocumentVariant) ?? null,
      tags: input.tags ?? [],
      is_redacted: input.is_redacted ?? false,
    });
  }

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
    );

    return { ...resource, downloadUrl };
  }

  async findByChapter(
    chapterId: string,
    filters?: BackworkResourceFilter,
  ): Promise<BackworkResource[]> {
    return this.resourceRepo.findByChapter(chapterId, filters);
  }

  async delete(id: string, chapterId: string): Promise<void> {
    const resource = await this.resourceRepo.findById(id, chapterId);
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
    data: { name?: string },
  ): Promise<BackworkDepartment> {
    return this.departmentRepo.update(id, data);
  }

  async getProfessors(chapterId: string): Promise<BackworkProfessor[]> {
    return this.professorRepo.findByChapter(chapterId);
  }

  private async resolveOrCreateDepartment(
    chapterId: string,
    code: string,
  ): Promise<string> {
    const existing = await this.departmentRepo.findByCode(chapterId, code);
    if (existing) return existing.id;

    const created = await this.departmentRepo.create({
      chapter_id: chapterId,
      code,
    });
    return created.id;
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
