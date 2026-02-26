import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { Event } from '../../domain/entities/event.entity';

export interface CreateEventInput {
  chapter_id: string;
  name: string;
  description?: string | null;
  location?: string | null;
  start_time: string;
  end_time: string;
  point_value?: number;
  is_mandatory?: boolean;
  recurrence_rule?: string | null;
  required_role_ids?: string[] | null;
  notes?: string | null;
}

export interface UpdateEventInput {
  name?: string;
  description?: string | null;
  location?: string | null;
  start_time?: string;
  end_time?: string;
  point_value?: number;
  is_mandatory?: boolean;
  recurrence_rule?: string | null;
  required_role_ids?: string[] | null;
  notes?: string | null;
}

@Injectable()
export class EventService {
  constructor(
    @Inject(EVENT_REPOSITORY) private readonly eventRepo: IEventRepository,
  ) {}

  async findById(id: string, chapterId: string): Promise<Event> {
    const event = await this.eventRepo.findById(id, chapterId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async findByChapter(chapterId: string): Promise<Event[]> {
    return this.eventRepo.findByChapter(chapterId);
  }

  async create(input: CreateEventInput): Promise<Event> {
    const { start_time, end_time } = input;

    const start = new Date(start_time);
    const end = new Date(end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(
        'start_time and end_time must be valid ISO dates',
      );
    }
    if (end <= start) {
      throw new BadRequestException('end_time must be after start_time');
    }

    return this.eventRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      description: input.description ?? null,
      location: input.location ?? null,
      start_time: input.start_time,
      end_time: input.end_time,
      point_value: input.point_value ?? 10,
      is_mandatory: input.is_mandatory ?? false,
      recurrence_rule: input.recurrence_rule ?? null,
      parent_event_id: null,
      required_role_ids: input.required_role_ids ?? null,
      notes: input.notes ?? null,
    });
  }

  async update(
    id: string,
    chapterId: string,
    input: UpdateEventInput,
  ): Promise<Event> {
    if (input.start_time || input.end_time) {
      const existing = await this.findById(id, chapterId);
      const startTime = input.start_time ?? existing.start_time;
      const endTime = input.end_time ?? existing.end_time;

      const start = new Date(startTime);
      const end = new Date(endTime);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new BadRequestException(
          'start_time and end_time must be valid ISO dates',
        );
      }
      if (end <= start) {
        throw new BadRequestException('end_time must be after start_time');
      }
    }

    return this.eventRepo.update(id, chapterId, {
      ...input,
    });
  }

  async delete(id: string, chapterId: string): Promise<void> {
    await this.eventRepo.delete(id, chapterId);
  }
}
