import { Inject, Injectable, Logger, ConflictException } from '@nestjs/common';
import { BACKWORK_REPOSITORY } from '../../domain/repositories/backwork.repository.interface';
import type { IBackworkRepository } from '../../domain/repositories/backwork.repository.interface';
import { S3Service } from '../../infrastructure/storage/s3.service';
import { BackworkResource } from '../../domain/entities/backwork.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BackworkService {
  private readonly logger = new Logger(BackworkService.name);

  constructor(
    @Inject(BACKWORK_REPOSITORY)
    private readonly backworkRepo: IBackworkRepository,
    private readonly s3Service: S3Service,
  ) {}

  async getUploadUrl(chapterId: string, filename: string, contentType: string) {
    const fileId = uuidv4();
    const extension = filename.split('.').pop();
    const s3Key = `chapters/${chapterId}/backwork/${fileId}.${extension}`;

    const uploadUrl = await this.s3Service.getUploadPresignedUrl(
      s3Key,
      contentType,
    );

    return {
      uploadUrl,
      s3Key,
    };
  }

  async createResource(data: {
    chapterId: string;
    uploaderId: string;
    courseCode: string;
    courseName: string;
    professorName: string;
    term: string;
    title: string;
    s3Key: string;
    fileHash: string;
    tags: string[];
  }): Promise<BackworkResource> {
    // 1. Auto-vivify Course
    let course = await this.backworkRepo.findCourseByCode(
      data.chapterId,
      data.courseCode,
    );
    if (!course) {
      this.logger.log(
        `Auto-vivifying course ${data.courseCode} for chapter ${data.chapterId}`,
      );
      course = await this.backworkRepo.createCourse({
        chapterId: data.chapterId,
        code: data.courseCode,
        name: data.courseName,
      });
    }

    // 2. Auto-vivify Professor
    let professor = await this.backworkRepo.findProfessorByName(
      data.chapterId,
      data.professorName,
    );
    if (!professor) {
      this.logger.log(
        `Auto-vivifying professor ${data.professorName} for chapter ${data.chapterId}`,
      );
      professor = await this.backworkRepo.createProfessor({
        chapterId: data.chapterId,
        name: data.professorName,
      });
    }

    // 3. Duplicate Detection
    const existing = await this.backworkRepo.findResourceByHash(
      data.chapterId,
      course.id,
      data.term,
      data.fileHash,
    );

    if (existing) {
      this.logger.warn(
        `Duplicate resource detected: ${data.fileHash} in chapter ${data.chapterId}`,
      );
      throw new ConflictException(
        'This resource has already been uploaded for this course and term.',
      );
    }

    // 4. Create Resource
    return this.backworkRepo.createResource({
      chapterId: data.chapterId,
      courseId: course.id,
      professorId: professor.id,
      uploaderId: data.uploaderId,
      title: data.title,
      term: data.term,
      s3Key: data.s3Key,
      fileHash: data.fileHash,
      tags: data.tags,
    });
  }

  async getDownloadUrl(resourceId: string): Promise<string> {
    const resource = await this.backworkRepo.findById(resourceId);
    if (!resource) {
      throw new Error('Resource not found');
    }

    return this.s3Service.getDownloadPresignedUrl(resource.s3Key);
  }
}
