import * as path from 'path';
import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  MAX_UPLOAD_LABEL,
} from '@repo/validation';
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
import { assertSafeStoragePath } from '../../domain/utils/storage-path';

const BACKWORK_BUCKET = 'backwork';

export interface RequestUploadUrlInput {
  chapterId: string;
  filename: string;
  contentType: string;
  sizeBytes?: number;
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
    const ext = input.filename.includes('.')
      ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!isAllowedUploadExtension('document', ext)) {
      throw new BadRequestException(`File extension "${ext}" is not allowed`);
    }

    if (!isAllowedUploadMime('document', input.contentType)) {
      throw new BadRequestException(
        `Content type "${input.contentType}" is not allowed`,
      );
    }

    if (
      input.sizeBytes !== undefined &&
      !isWithinUploadSizeLimit(input.sizeBytes)
    ) {
      throw new BadRequestException(
        `File exceeds the ${MAX_UPLOAD_LABEL} upload limit`,
      );
    }

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
    if (
      !input.storage_path.startsWith(`chapters/${input.chapter_id}/backwork/`)
    ) {
      throw new BadRequestException(
        'storage_path must be within the chapter backwork folder',
      );
    }
    // A prefix check is not containment — relative segments satisfy it and
    // still climb out, and this value is persisted and later handed to
    // getSignedDownloadUrl/deleteFile. The storage layer rejects them too, but
    // this write path must not rely on that alone: it is what turns any future
    // gap in that guard into a cross-bucket read of a service-role-signed URL.
    //
    // `assertSafeStoragePath` is domain-layer code and throws a plain `Error`;
    // this catch is what turns that into the `BadRequestException` (400) API
    // consumers have always seen on an unsafe path.
    try {
      assertSafeStoragePath(
        input.storage_path,
        'storage_path must not contain relative path segments',
      );
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

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
    chapterId: string,
    data: { name?: string },
  ): Promise<BackworkDepartment> {
    // The repository scopes the write to the active chapter, so `null` means
    // the department is either gone or owned by another chapter. Both surface
    // as 404 — a `backwork:admin` must not be able to probe for the existence
    // of another chapter's departments by UUID.
    const updated = await this.departmentRepo.update(id, chapterId, data);
    if (!updated) {
      throw new NotFoundException('Department not found');
    }
    return updated;
  }

  async getProfessors(chapterId: string): Promise<BackworkProfessor[]> {
    return this.professorRepo.findByChapter(chapterId);
  }

  async updateProfessor(
    id: string,
    chapterId: string,
    data: { name?: string },
  ): Promise<BackworkProfessor> {
    const updated = await this.professorRepo.update(id, chapterId, data);
    if (!updated) {
      throw new NotFoundException('Professor not found');
    }
    return updated;
  }

  /**
   * Deletes a department, or a professor when `entity: 'professor'`. Blocks
   * with a 400 (rather than orphaning the taxonomy on every resource that
   * still references it, which the FK's `on delete set null` would otherwise
   * do silently) while any resource is still tagged with it — `mergeXxx`
   * below is the guided path to clear that first.
   */
  async deleteDepartment(id: string, chapterId: string): Promise<void> {
    const existing = await this.departmentRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Department not found');
    }
    const referenced = await this.resourceRepo.countByDepartment(chapterId, id);
    if (referenced > 0) {
      throw new BadRequestException(
        `Cannot delete: ${referenced} resource(s) still reference this department. Merge it into another department first.`,
      );
    }
    await this.departmentRepo.delete(id, chapterId);
  }

  async deleteProfessor(id: string, chapterId: string): Promise<void> {
    const existing = await this.professorRepo.findById(id, chapterId);
    if (!existing) {
      throw new NotFoundException('Professor not found');
    }
    const referenced = await this.resourceRepo.countByProfessor(chapterId, id);
    if (referenced > 0) {
      throw new BadRequestException(
        `Cannot delete: ${referenced} resource(s) still reference this professor. Merge it into another professor first.`,
      );
    }
    await this.professorRepo.delete(id, chapterId);
  }

  /**
   * Merges a duplicate department into another: every resource tagged
   * `sourceId` is reassigned to `targetId`, then `sourceId` is deleted. Not
   * wrapped in a DB transaction — the reassign-then-delete order means the
   * only failure window is a resource created between the two calls, which
   * the FK's `on delete set null` degrades to a blank (not orphaned/broken)
   * department field on that one row, self-healing on the next re-tag. Lower
   * risk than the ledger-touching operations elsewhere in this codebase that
   * do need atomic RPCs.
   */
  async mergeDepartments(
    sourceId: string,
    targetId: string,
    chapterId: string,
  ): Promise<{ reassigned: number }> {
    if (sourceId === targetId) {
      throw new BadRequestException('Cannot merge a department into itself');
    }
    const [source, target] = await Promise.all([
      this.departmentRepo.findById(sourceId, chapterId),
      this.departmentRepo.findById(targetId, chapterId),
    ]);
    if (!source || !target) {
      throw new NotFoundException('Department not found');
    }
    const reassigned = await this.resourceRepo.reassignDepartment(
      chapterId,
      sourceId,
      targetId,
    );
    await this.departmentRepo.delete(sourceId, chapterId);
    return { reassigned };
  }

  async mergeProfessors(
    sourceId: string,
    targetId: string,
    chapterId: string,
  ): Promise<{ reassigned: number }> {
    if (sourceId === targetId) {
      throw new BadRequestException('Cannot merge a professor into itself');
    }
    const [source, target] = await Promise.all([
      this.professorRepo.findById(sourceId, chapterId),
      this.professorRepo.findById(targetId, chapterId),
    ]);
    if (!source || !target) {
      throw new NotFoundException('Professor not found');
    }
    const reassigned = await this.resourceRepo.reassignProfessor(
      chapterId,
      sourceId,
      targetId,
    );
    await this.professorRepo.delete(sourceId, chapterId);
    return { reassigned };
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
