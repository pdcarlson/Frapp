import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EVENT_TYPES_MAX } from '@repo/validation';
import { EVENT_TYPE_REPOSITORY } from '#domain/repositories/event-type.repository.interface';
import type { IEventTypeRepository } from '#domain/repositories/event-type.repository.interface';
import type { EventType } from '#domain/entities/event-type.entity';

/**
 * A chapter's event types (#3730, `spec/behavior/events.md` § Event types).
 *
 * A type is a name and the points and attendance an event of that kind starts
 * from. The New event form copies them onto the event, which keeps its own
 * values, so nothing here touches events: editing or deleting a type leaves
 * every event already made as it was (a delete only clears their type).
 */
@Injectable()
export class EventTypeService {
  constructor(
    @Inject(EVENT_TYPE_REPOSITORY)
    private readonly eventTypeRepo: IEventTypeRepository,
  ) {}

  list(chapterId: string): Promise<EventType[]> {
    return this.eventTypeRepo.findByChapter(chapterId);
  }

  /** Adds a type at the end of the chapter's list. */
  async create(
    chapterId: string,
    input: { name: string; point_value?: number; is_mandatory?: boolean },
  ): Promise<EventType> {
    const existing = await this.eventTypeRepo.findByChapter(chapterId);
    if (existing.length >= EVENT_TYPES_MAX) {
      throw new BadRequestException(
        `A chapter can have at most ${EVENT_TYPES_MAX} event types`,
      );
    }
    const last = existing.reduce((max, t) => Math.max(max, t.position), 0);
    const created = await this.eventTypeRepo.create({
      chapter_id: chapterId,
      name: input.name.trim(),
      point_value: input.point_value ?? 0,
      is_mandatory: input.is_mandatory ?? false,
      position: last + 1,
    });
    if (!created) throw this.nameTaken(input.name);
    return created;
  }

  async update(
    id: string,
    chapterId: string,
    input: { name?: string; point_value?: number; is_mandatory?: boolean },
  ): Promise<EventType> {
    // Rebuilt key by key, so only the three editable columns can reach the
    // write whatever the DTO instance carries.
    const patch: Partial<
      Pick<EventType, 'name' | 'point_value' | 'is_mandatory'>
    > = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.point_value !== undefined) patch.point_value = input.point_value;
    if (input.is_mandatory !== undefined) {
      patch.is_mandatory = input.is_mandatory;
    }
    if (Object.keys(patch).length === 0) {
      const found = await this.eventTypeRepo.findById(id, chapterId);
      if (!found) throw new NotFoundException('Event type not found');
      return found;
    }
    const updated = await this.eventTypeRepo.update(id, chapterId, patch);
    if (updated === undefined) {
      throw new NotFoundException('Event type not found');
    }
    if (updated === null) throw this.nameTaken(input.name ?? '');
    return updated;
  }

  /** Its events keep their points and attendance and lose the type. */
  async remove(id: string, chapterId: string): Promise<void> {
    const found = await this.eventTypeRepo.findById(id, chapterId);
    if (!found) throw new NotFoundException('Event type not found');
    await this.eventTypeRepo.delete(id, chapterId);
  }

  /**
   * Refuses a type id that isn't one of the chapter's, before an event write
   * reaches the composite foreign key (which would otherwise surface as a
   * 500). `null` and `undefined` pass: no type, or the field left alone.
   */
  async assertBelongs(
    id: string | null | undefined,
    chapterId: string,
  ): Promise<void> {
    if (id === null || id === undefined) return;
    const found = await this.eventTypeRepo.findById(id, chapterId);
    if (!found) throw new BadRequestException('Event type not found');
  }

  private nameTaken(name: string): ConflictException {
    return new ConflictException(
      `This chapter already has an event type named "${name.trim()}"`,
    );
  }
}
