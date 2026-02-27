import { Module } from '@nestjs/common';
import { EventService } from '../../application/services/event.service';
import { EventController } from '../../interface/controllers/event.controller';
import { SupabaseEventRepository } from '../../infrastructure/supabase/repositories/supabase-event.repository';
import { EVENT_REPOSITORY } from '../../domain/repositories/event.repository.interface';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [EventController],
  providers: [
    EventService,
    { provide: EVENT_REPOSITORY, useClass: SupabaseEventRepository },
  ],
  exports: [EventService, EVENT_REPOSITORY],
})
export class EventModule {}
