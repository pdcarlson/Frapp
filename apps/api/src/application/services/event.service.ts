import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import type { IEventRepository } from '../../domain/repositories/event.repository.interface';
import { Event } from '../../domain/entities/event.entity';

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
  ) {}

  async createEvent(data: {
    chapterId: string;
    name: string;
    description: string | null;
    startTime: Date;
    endTime: Date;
    pointValue: number;
    isMandatory: boolean;
  }): Promise<Event> {
    this.logger.log(
      `Creating event ${data.name} for chapter ${data.chapterId}`,
    );
    return this.eventRepo.create(data);
  }

  async getChapterEvents(chapterId: string): Promise<Event[]> {
    return this.eventRepo.findByChapter(chapterId);
  }

  async getEvent(id: string): Promise<Event | null> {
    return this.eventRepo.findById(id);
  }
}
