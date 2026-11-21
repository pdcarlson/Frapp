import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PLEDGE_CLASSES_MAX } from '@repo/validation';
import { PLEDGE_CLASS_REPOSITORY } from '#domain/repositories/pledge-class.repository.interface';
import type { IPledgeClassRepository } from '#domain/repositories/pledge-class.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { CHAPTER_GROUP_REPOSITORY } from '#domain/repositories/chapter-group.repository.interface';
import type { IChapterGroupRepository } from '#domain/repositories/chapter-group.repository.interface';
import type {
  PledgeClass,
  PledgeClassAssignment,
} from '#domain/entities/pledge-class.entity';
import type { Member } from '#domain/entities/member.entity';
import { canReach } from '#domain/utils/role-rank';
import { memberRankIn } from '#domain/utils/rank-context';
import { assertMayChangeGroupAccess } from './chapter-group.service';
import { RbacService } from './rbac.service';

/**
 * A chapter's pledge classes, and each member's class and order number
 * (#3939).
 *
 * Nothing here assumes how a chapter uses them. A class is a name and a place
 * in a list; the order number is one integer that works inside a class or
 * chapter-wide; either can be used without the other, and a chapter that uses
 * neither has no rows.
 *
 * Every route needs `roles:manage` (the controller). Assigning members, and
 * deleting a class (which takes it off every member in it), also keep two
 * rules: an officer changes the class only of members ranked below them (or
 * their own), as for roles; and a class whose group a channel list names
 * decides who reads that channel, so changing who is in it, or deleting it
 * (which takes the group off those lists), needs `channels:manage`, as a
 * manual group does (`assertMayChangeGroupAccess`).
 */
@Injectable()
export class PledgeClassService {
  constructor(
    @Inject(PLEDGE_CLASS_REPOSITORY)
    private readonly pledgeClassRepo: IPledgeClassRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    @Inject(CHAPTER_GROUP_REPOSITORY)
    private readonly groupRepo: IChapterGroupRepository,
    private readonly rbac: RbacService,
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

  /**
   * Its members lose the class and keep their order number, and its group
   * leaves every channel list that named it, so both rules of {@link assign}
   * apply: every member in it must be within the caller's reach, and a class
   * a channel list names needs `channels:manage`.
   */
  async remove(
    id: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<void> {
    const found = await this.pledgeClassRepo.findById(id, chapterId);
    if (!found) throw new NotFoundException('Class not found');
    const classId = found.id.toLowerCase();
    const members = (await this.memberRepo.findByChapter(chapterId)).filter(
      (m) => m.pledge_class_id?.toLowerCase() === classId,
    );
    await this.assertWithinReach(chapterId, actorUserId, members);
    await this.assertMayChangeClassAccess(chapterId, actorUserId, [classId]);
    await this.pledgeClassRepo.delete(id, chapterId);
  }

  /**
   * Sets class and order number on each listed member, all or none. Whether
   * every member and class belongs to the chapter is decided by the write
   * itself (`assign_member_pledge_classes`), so a class deleted or a member
   * removed while an officer is saving refuses the save instead of slipping
   * between a check and the write.
   *
   * Only the members whose class or number would change are judged by
   * {@link assertMayAssign}, so an editor that re-sends a member as they are
   * is never refused for them.
   */
  async assign(
    chapterId: string,
    actorUserId: string,
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
    await this.assertMayAssign(chapterId, actorUserId, wanted);
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

  /**
   * The rank rule and the channel rule of {@link assign} (see the class
   * comment), checked against the members as they are now. A listed id that
   * isn't a member of the chapter is left to the write, which refuses it.
   */
  private async assertMayAssign(
    chapterId: string,
    actorUserId: string,
    wanted: readonly PledgeClassAssignment[],
  ): Promise<void> {
    const members = await this.memberRepo.findByChapter(chapterId);
    const byId = new Map(members.map((m) => [m.id.toLowerCase(), m]));
    const lower = (id: string | null) => id?.toLowerCase() ?? null;
    const changes = wanted.flatMap((a) => {
      const member = byId.get(a.member_id);
      if (!member) return [];
      const from = lower(member.pledge_class_id);
      const to = lower(a.pledge_class_id);
      return from !== to || member.order_number !== a.order_number
        ? [{ member, from, to }]
        : [];
    });
    if (changes.length === 0) return;

    await this.assertWithinReach(
      chapterId,
      actorUserId,
      changes.map(({ member }) => member),
    );
    const moved = new Set(
      changes
        .filter(({ from, to }) => from !== to)
        .flatMap(({ from, to }) => [from, to])
        .filter((id): id is string => id !== null),
    );
    await this.assertMayChangeClassAccess(chapterId, actorUserId, [...moved]);
  }

  /**
   * The rank rule: a caller without `*` changes the class of only members
   * ranked strictly below them, and their own.
   */
  private async assertWithinReach(
    chapterId: string,
    actorUserId: string,
    members: readonly Member[],
  ): Promise<void> {
    if (members.length === 0) return;
    const context = await this.rbac.getRankContext(chapterId, actorUserId);
    const outOfReach = (member: Member) =>
      !context.reach.wildcard &&
      member.id !== context.reach.memberId &&
      member.user_id !== actorUserId &&
      !canReach(context.reach, memberRankIn(context, member));
    if (members.some(outOfReach)) {
      throw new ForbiddenException(RANK_REFUSAL);
    }
  }

  /** The channel rule, for the groups of the classes `classIds` (lower-cased). */
  private async assertMayChangeClassAccess(
    chapterId: string,
    actorUserId: string,
    classIds: readonly string[],
  ): Promise<void> {
    if (classIds.length === 0) return;
    const ids = new Set(classIds);
    const groupIds = (await this.groupRepo.findByChapter(chapterId))
      .filter(
        (group) =>
          group.kind === 'pledge_class' &&
          group.pledge_class_id !== null &&
          ids.has(group.pledge_class_id.toLowerCase()),
      )
      .map((group) => group.id);
    await assertMayChangeGroupAccess(this.groupRepo, this.rbac, {
      chapterId,
      actorUserId,
      groupIds,
      refusal: GATES_A_CHANNEL,
    });
  }

  private nameTaken(name: string): ConflictException {
    return new ConflictException(
      `This chapter already has a class named "${name.trim()}"`,
    );
  }
}

const RANK_REFUSAL =
  'You can only set the class of members ranked below you, and your own.';
const GATES_A_CHANNEL =
  'A channel uses this class to decide who can see or post in it, so only someone who can manage channels can change who is in it.';
