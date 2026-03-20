import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { Event } from '../../domain/entities/event.entity';
import { NotificationService } from './notification.service';

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
    private readonly notificationService: NotificationService,
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

    try {
      await this.notificationService.notifyChapter(input.chapter_id, {
        title: 'New Event',
        body: `${parent.name} has been scheduled`,
        priority: 'SILENT',
        category: 'events',
        data: { target: { screen: 'events', eventId: parent.id } },
      });
    } catch {}

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

    // ⚡ Bolt: Optimize recurring instance creation using Promise.all
    // Eliminates N+1 sequential database queries by executing them concurrently.
    const promises = Array.from({ length: count }, (_, idx) => {
      const i = idx + 1;
      const instanceStart = new Date(start);
      const instanceEnd = new Date(end);

      if (rule === 'WEEKLY') {
        instanceStart.setDate(instanceStart.getDate() + i * 7);
        instanceEnd.setDate(instanceEnd.getDate() + i * 7);
      } else if (rule === 'BIWEEKLY') {
        instanceStart.setDate(instanceStart.getDate() + i * 14);
        instanceEnd.setDate(instanceEnd.getDate() + i * 14);
      } else if (rule === 'MONTHLY') {
        const targetStartMonth = start.getMonth() + i;
        instanceStart.setDate(1);
        instanceStart.setMonth(targetStartMonth);
        const maxStartDay = new Date(
          instanceStart.getFullYear(),
          instanceStart.getMonth() + 1,
          0,
        ).getDate();
        instanceStart.setDate(Math.min(start.getDate(), maxStartDay));

        const targetEndMonth = end.getMonth() + i;
        instanceEnd.setDate(1);
        instanceEnd.setMonth(targetEndMonth);
        const maxEndDay = new Date(
          instanceEnd.getFullYear(),
          instanceEnd.getMonth() + 1,
          0,
        ).getDate();
        instanceEnd.setDate(Math.min(end.getDate(), maxEndDay));
      }

      return this.eventRepo.create({
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
    });

    await Promise.all(promises);
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

    const updated = await this.eventRepo.update(id, chapterId, {
      ...input,
    });

    if (input.start_time || input.end_time || input.location !== undefined) {
      try {
        await this.notificationService.notifyChapter(chapterId, {
          title: 'Event Updated',
          body: `${updated.name} has been updated`,
          priority: 'NORMAL',
          category: 'events',
          data: { target: { screen: 'events', eventId: updated.id } },
        });
      } catch {}
    }

    return updated;
  }

  async delete(id: string, chapterId: string): Promise<void> {
    await this.eventRepo.delete(id, chapterId);
  }

  async generateIcs(eventId: string, chapterId: string): Promise<string> {
    const event = await this.findById(eventId, chapterId);

    const formatDate = (iso: string): string =>
      new Date(iso)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');

    const escapeText = (text: string): string =>
      text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Frapp//Events//EN',
      'BEGIN:VEVENT',
      `DTSTART:${formatDate(event.start_time)}`,
      `DTEND:${formatDate(event.end_time)}`,
      `SUMMARY:${escapeText(event.name)}`,
    ];

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }

    lines.push(`UID:${event.id}@frapp.live`, 'END:VEVENT', 'END:VCALENDAR');

    return lines.join('\r\n');
  }
}
