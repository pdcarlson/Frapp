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

    const parent = await this.eventRepo.create({
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

    if (parent.recurrence_rule) {
      await this.generateRecurringInstances(parent);
    }

    return parent;
  }

  private async generateRecurringInstances(parent: Event): Promise<void> {
    const rule = parent.recurrence_rule;
    if (!rule) return;

    const start = new Date(parent.start_time);
    const end = new Date(parent.end_time);

    let count: number;
    switch (rule) {
      case 'WEEKLY':
        count = 12;
        break;
      case 'BIWEEKLY':
        count = 6;
        break;
      case 'MONTHLY':
        count = 6;
        break;
      default:
        return;
    }

    for (let i = 1; i <= count; i++) {
      const instanceStart = new Date(start);
      const instanceEnd = new Date(end);

      if (rule === 'WEEKLY') {
        instanceStart.setDate(instanceStart.getDate() + i * 7);
        instanceEnd.setDate(instanceEnd.getDate() + i * 7);
      } else if (rule === 'BIWEEKLY') {
        instanceStart.setDate(instanceStart.getDate() + i * 14);
        instanceEnd.setDate(instanceEnd.getDate() + i * 14);
      } else if (rule === 'MONTHLY') {
        instanceStart.setMonth(instanceStart.getMonth() + i);
        instanceEnd.setMonth(instanceEnd.getMonth() + i);
      }

      await this.eventRepo.create({
        chapter_id: parent.chapter_id,
        name: parent.name,
        description: parent.description,
        location: parent.location,
        start_time: instanceStart.toISOString(),
        end_time: instanceEnd.toISOString(),
        point_value: parent.point_value,
        is_mandatory: parent.is_mandatory,
        recurrence_rule: null,
        parent_event_id: parent.id,
        required_role_ids: parent.required_role_ids,
        notes: parent.notes,
      });
    }
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
