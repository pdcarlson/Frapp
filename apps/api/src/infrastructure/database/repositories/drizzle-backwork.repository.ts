import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IBackworkRepository } from '../../../domain/repositories/backwork.repository.interface';
import {
  BackworkCourse,
  BackworkProfessor,
  BackworkResource,
} from '../../../domain/entities/backwork.entity';

@Injectable()
export class DrizzleBackworkRepository implements IBackworkRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async findCourseByCode(
    chapterId: string,
    code: string,
  ): Promise<BackworkCourse | null> {
    const [result] = await this.db
      .select()
      .from(schema.backworkCourses)
      .where(
        and(
          eq(schema.backworkCourses.chapterId, chapterId),
          eq(schema.backworkCourses.code, code),
        ),
      )
      .limit(1);

    if (!result) return null;
    return new BackworkCourse(
      result.id,
      result.chapterId,
      result.code,
      result.name,
      result.createdAt,
    );
  }

  async createCourse(
    course: Omit<BackworkCourse, 'id' | 'createdAt'>,
  ): Promise<BackworkCourse> {
    const [result] = await this.db
      .insert(schema.backworkCourses)
      .values({
        chapterId: course.chapterId,
        code: course.code,
        name: course.name,
      })
      .returning();

    return new BackworkCourse(
      result.id,
      result.chapterId,
      result.code,
      result.name,
      result.createdAt,
    );
  }

  async findProfessorByName(
    chapterId: string,
    name: string,
  ): Promise<BackworkProfessor | null> {
    const [result] = await this.db
      .select()
      .from(schema.backworkProfessors)
      .where(
        and(
          eq(schema.backworkProfessors.chapterId, chapterId),
          eq(schema.backworkProfessors.name, name),
        ),
      )
      .limit(1);

    if (!result) return null;
    return new BackworkProfessor(
      result.id,
      result.chapterId,
      result.name,
      result.createdAt,
    );
  }

  async createProfessor(
    professor: Omit<BackworkProfessor, 'id' | 'createdAt'>,
  ): Promise<BackworkProfessor> {
    const [result] = await this.db
      .insert(schema.backworkProfessors)
      .values({
        chapterId: professor.chapterId,
        name: professor.name,
      })
      .returning();

    return new BackworkProfessor(
      result.id,
      result.chapterId,
      result.name,
      result.createdAt,
    );
  }

  async createResource(
    resource: Omit<BackworkResource, 'id' | 'createdAt'>,
  ): Promise<BackworkResource> {
    const [result] = await this.db
      .insert(schema.backworkResources)
      .values({
        chapterId: resource.chapterId,
        courseId: resource.courseId,
        professorId: resource.professorId,
        uploaderId: resource.uploaderId,
        title: resource.title,
        term: resource.term,
        s3Key: resource.s3Key,
        fileHash: resource.fileHash,
        tags: resource.tags,
      })
      .returning();

    return new BackworkResource(
      result.id,
      result.chapterId,
      result.courseId,
      result.professorId,
      result.uploaderId,
      result.title,
      result.term,
      result.s3Key,
      result.fileHash,
      result.tags,
      result.createdAt,
    );
  }

  async findResourceByHash(
    chapterId: string,
    courseId: string,
    term: string,
    fileHash: string,
  ): Promise<BackworkResource | null> {
    const [result] = await this.db
      .select()
      .from(schema.backworkResources)
      .where(
        and(
          eq(schema.backworkResources.chapterId, chapterId),
          eq(schema.backworkResources.courseId, courseId),
          eq(schema.backworkResources.term, term),
          eq(schema.backworkResources.fileHash, fileHash),
        ),
      )
      .limit(1);

    if (!result) return null;
    return new BackworkResource(
      result.id,
      result.chapterId,
      result.courseId,
      result.professorId,
      result.uploaderId,
      result.title,
      result.term,
      result.s3Key,
      result.fileHash,
      result.tags,
      result.createdAt,
    );
  }

  async findById(id: string): Promise<BackworkResource | null> {
    const [result] = await this.db
      .select()
      .from(schema.backworkResources)
      .where(eq(schema.backworkResources.id, id))
      .limit(1);

    if (!result) return null;
    return new BackworkResource(
      result.id,
      result.chapterId,
      result.courseId,
      result.professorId,
      result.uploaderId,
      result.title,
      result.term,
      result.s3Key,
      result.fileHash,
      result.tags,
      result.createdAt,
    );
  }

  async findByChapter(chapterId: string): Promise<BackworkResource[]> {
    const results = await this.db
      .select()
      .from(schema.backworkResources)
      .where(eq(schema.backworkResources.chapterId, chapterId));

    return results.map(
      (result) =>
        new BackworkResource(
          result.id,
          result.chapterId,
          result.courseId,
          result.professorId,
          result.uploaderId,
          result.title,
          result.term,
          result.s3Key,
          result.fileHash,
          result.tags,
          result.createdAt,
        ),
    );
  }
}
