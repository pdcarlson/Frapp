import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PLEDGE_CLASSES_MAX } from '@repo/validation';
import { PLEDGE_CLASS_REPOSITORY } from '#domain/repositories/pledge-class.repository.interface';
import type { IPledgeClassRepository } from '#domain/repositories/pledge-class.repository.interface';
import type {
  PledgeClass,
  PledgeClassAssignment,
} from '#domain/entities/pledge-class.entity';

/**
 * A chapter's pledge classes, and each member's class and order number
 * (#3939).
 *
 * Nothing here assumes how a chapter uses them. A class is a name and a place
 * in a list; the order number is one integer that works inside a class or
 * chapter-wide; either can be used without the other, and a chapter that uses
 * neither has no rows.
 */
@Injectable()
export class PledgeClassService {
  constructor(
    @Inject(PLEDGE_CLASS_REPOSITORY)
    private readonly pledgeClassRepo: IPledgeClassRepository,
  ) {}

  list(chapterId: string): Promise<PledgeClass[]> {
    return this.pledgeClassRepo.findByChapter(chapterId);
  }

  /** Adds a class at the end of the list: the newest class. */
  async create(chapterId: string, name: string): Promise<PledgeClass> {
    const existing = await this.pledgeClassRepo.findByChapter(chapterId);
    if (existing.length >= PLEDGE_CLASSES_MAX) {
      throw new BadRequestException(
        `A chapter can have at most ${PLEDGE_CLASSES_MAX} classes`,
      );
    }
    const last = existing.reduce((max, c) => Math.max(max, c.position), 0);
    const created = await this.pledgeClassRepo.create({
      chapter_id: chapterId,
      name: name.trim(),
      position: last + 1,
    });
    if (!created) throw this.nameTaken(name);
    return created;
  }

  async rename(
    id: string,
    chapterId: string,
    name: string,
  ): Promise<PledgeClass> {
    const renamed = await this.pledgeClassRepo.rename(
      id,
      chapterId,
      name.trim(),
    );
    if (renamed === undefined) throw new NotFoundException('Class not found');
    if (renamed === null) throw this.nameTaken(name);
    return renamed;
  }

  /**
   * `ids` must be exactly the chapter's classes, each once. An editor that
   * loaded the list before someone else added or deleted a class is refused
   * rather than applied, because applying it would leave the class it never
   * saw at an arbitrary place among the ones it moved.
   */
  async reorder(chapterId: string, ids: string[]): Promise<PledgeClass[]> {
    const existing = await this.pledgeClassRepo.findByChapter(chapterId);
    const known = new Set(existing.map((c) => c.id));
    // Lower-cased: Postgres returns a uuid in lower case whatever the caller
    // sent, and an upper-case id is the same class.
    const asked = new Set(ids.map((id) => id.toLowerCase()));
    if (asked.size !== ids.length) {
      throw new BadRequestException('A class is listed more than once');
    }
    const same =
      asked.size === known.size && [...asked].every((id) => known.has(id));
    if (!same) {
      throw new ConflictException(
        'The class list changed. Reload it and try again.',
      );
    }
    if (asked.size > 0) {
      await this.pledgeClassRepo.reorder(chapterId, [...asked]);
    }
    return this.pledgeClassRepo.findByChapter(chapterId);
  }

  /** Its members lose the class and keep their order number. */
  async remove(id: string, chapterId: string): Promise<void> {
    const found = await this.pledgeClassRepo.findById(id, chapterId);
    if (!found) throw new NotFoundException('Class not found');
    await this.pledgeClassRepo.delete(id, chapterId);
  }

  /**
   * Sets class and order number on each listed member, all or none. Whether
   * every member and class belongs to the chapter is decided by the write
   * itself (`assign_member_pledge_classes`), so a class deleted or a member
   * removed while an officer is saving refuses the save instead of slipping
   * between a check and the write.
   */
  async assign(
    chapterId: string,
    assignments: PledgeClassAssignment[],
  ): Promise<PledgeClassAssignment[]> {
    // Rebuilt field by field: the payload becomes the RPC's JSON, and a DTO
    // instance must not carry anything else into it.
    const wanted = assignments.map((a) => ({
      member_id: a.member_id.toLowerCase(),
      pledge_class_id: a.pledge_class_id,
      order_number: a.order_number,
    }));
    if (new Set(wanted.map((a) => a.member_id)).size !== wanted.length) {
      throw new BadRequestException('A member is listed more than once');
    }
    const updated = await this.pledgeClassRepo.assignMembers(chapterId, wanted);
    if (updated === 'member_not_found') {
      throw new NotFoundException('Member not found');
    }
    if (updated === 'class_not_found') {
      throw new BadRequestException('Class not found');
    }
    return updated.map((m) => ({
      member_id: m.id,
      pledge_class_id: m.pledge_class_id,
      order_number: m.order_number,
    }));
  }

  private nameTaken(name: string): ConflictException {
    return new ConflictException(
      `This chapter already has a class named "${name.trim()}"`,
    );
  }
}
