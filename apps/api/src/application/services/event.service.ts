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

/** How a recurring event edit/delete applies (non-recurring events ignore this). */
export type RecurringSeriesScope =
  | 'this_instance'
  | 'this_and_future'
  | 'entire_series';

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
  /** When set on PATCH, controls propagation for recurring series. Defaults to this_instance. */
  scope?: RecurringSeriesScope;
}

export interface DeleteEventInput {
  scope?: RecurringSeriesScope;
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

  private isPartOfRecurringSeries(event: Event): boolean {
    const hasRule =
      typeof event.recurrence_rule === 'string' &&
      event.recurrence_rule.length > 0;
    return hasRule || event.parent_event_id != null;
  }

  private assertValidTimeRange(startIso: string, endIso: string): void {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(
        'start_time and end_time must be valid ISO dates',
      );
    }
    if (end <= start) {
      throw new BadRequestException('end_time must be after start_time');
    }
  }

  private normalizeScope(scope: string | undefined): RecurringSeriesScope {
    if (scope === undefined || scope === 'this_instance') {
      return 'this_instance';
    }
    if (scope === 'this_and_future' || scope === 'entire_series') {
      return scope;
    }
    throw new BadRequestException(
      'scope must be this_instance, this_and_future, or entire_series',
    );
  }

  private stripScopeFromUpdate(
    input: UpdateEventInput,
  ): Omit<UpdateEventInput, 'scope'> {
    const rest = { ...input };
    delete rest.scope;
    return rest;
  }

  async update(
    id: string,
    chapterId: string,
    input: UpdateEventInput,
  ): Promise<Event> {
    const scope = this.normalizeScope(input.scope);
    const payload = this.stripScopeFromUpdate(input);

    const target = await this.findById(id, chapterId);

    if (payload.start_time || payload.end_time) {
      const startTime = payload.start_time ?? target.start_time;
      const endTime = payload.end_time ?? target.end_time;
      this.assertValidTimeRange(startTime, endTime);
    }

    if (!this.isPartOfRecurringSeries(target) || scope === 'this_instance') {
      const updated = await this.eventRepo.update(id, chapterId, {
        ...payload,
      });
      await this.maybeNotifyEventUpdated(chapterId, updated, payload);
      return updated;
    }

    const parent = target.parent_event_id
      ? await this.findById(target.parent_event_id, chapterId)
      : target;

    const instances = await this.eventRepo.findInstancesByParentId(
      parent.id,
      chapterId,
    );

    const byStart = (a: Event, b: Event) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime();

    let rowsToUpdate: Event[];
    if (scope === 'entire_series') {
      rowsToUpdate = [parent, ...instances].sort(byStart);
    } else {
      // this_and_future
      if (target.parent_event_id) {
        const futureInstances = instances
          .filter(
            (row) => new Date(row.start_time) >= new Date(target.start_time),
          )
          .sort(byStart);
        rowsToUpdate = [parent, ...futureInstances].sort(byStart);
      } else {
        rowsToUpdate = [parent, ...instances].sort(byStart);
      }
    }

    const anchor = rowsToUpdate.find((row) => row.id === id) ?? target;
    const anchorIndex = rowsToUpdate.findIndex((row) => row.id === anchor.id);
    if (anchorIndex < 0) {
      throw new BadRequestException(
        'Could not resolve recurring series anchor',
      );
    }

    let startDeltaMs = 0;
    let endDeltaMs = 0;
    if (payload.start_time || payload.end_time) {
      const newStart = new Date(
        payload.start_time ?? anchor.start_time,
      ).getTime();
      const newEnd = new Date(payload.end_time ?? anchor.end_time).getTime();
      startDeltaMs = newStart - new Date(anchor.start_time).getTime();
      endDeltaMs = newEnd - new Date(anchor.end_time).getTime();
    }

    const sharedFields: Partial<Event> = { ...payload };
    delete sharedFields.start_time;
    delete sharedFields.end_time;

    let lastUpdated: Event | null = null;
    for (let i = 0; i < rowsToUpdate.length; i++) {
      const row = rowsToUpdate[i];
      const patch: Partial<Event> = { ...sharedFields };
      if (row.parent_event_id) {
        delete patch.recurrence_rule;
      }

      if (payload.start_time || payload.end_time) {
        const rel = i - anchorIndex;
        if (rel === 0) {
          patch.start_time = payload.start_time ?? row.start_time;
          patch.end_time = payload.end_time ?? row.end_time;
        } else {
          patch.start_time = new Date(
            new Date(row.start_time).getTime() + startDeltaMs,
          ).toISOString();
          patch.end_time = new Date(
            new Date(row.end_time).getTime() + endDeltaMs,
          ).toISOString();
        }
      }

      if (Object.keys(patch).length === 0) {
        continue;
      }
      lastUpdated = await this.eventRepo.update(row.id, chapterId, patch);
    }

    const updated = lastUpdated ?? (await this.findById(id, chapterId));
    await this.maybeNotifyEventUpdated(chapterId, updated, payload);
    return updated;
  }

  private async maybeNotifyEventUpdated(
    chapterId: string,
    updated: Event,
    payload: Omit<UpdateEventInput, 'scope'>,
  ): Promise<void> {
    if (
      payload.start_time ||
      payload.end_time ||
      payload.location !== undefined
    ) {
      try {
        await this.notificationService.notifyChapter(chapterId, {
          title: 'Event Updated',
          body: `${updated.name} has been updated`,
          priority: 'NORMAL',
          category: 'events',
          data: { target: { screen: 'events', eventId: updated.id } },
        });
      } catch {
        /* non-fatal */
      }
    }
  }

  async delete(
    id: string,
    chapterId: string,
    input?: DeleteEventInput,
  ): Promise<void> {
    const scope = this.normalizeScope(input?.scope);
    const target = await this.findById(id, chapterId);

    if (!this.isPartOfRecurringSeries(target) || scope === 'this_instance') {
      await this.eventRepo.delete(id, chapterId);
      return;
    }

    const parent = target.parent_event_id
      ? await this.findById(target.parent_event_id, chapterId)
      : target;

    const instances = await this.eventRepo.findInstancesByParentId(
      parent.id,
      chapterId,
    );

    const byStartDesc = (a: Event, b: Event) =>
      new Date(b.start_time).getTime() - new Date(a.start_time).getTime();

    let toDelete: Event[];
    if (scope === 'entire_series') {
      toDelete = [...instances, parent].sort(byStartDesc);
    } else {
      if (target.parent_event_id) {
        toDelete = [
          target,
          ...instances.filter(
            (row) => new Date(row.start_time) > new Date(target.start_time),
          ),
        ].sort(byStartDesc);
      } else {
        // Parent row is the series anchor; "this and future" from the first
        // occurrence removes the whole generated series (same as entire_series).
        toDelete = [...instances, parent].sort(byStartDesc);
      }
    }

    const seen = new Set<string>();
    for (const row of toDelete) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      await this.eventRepo.delete(row.id, chapterId);
    }
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
