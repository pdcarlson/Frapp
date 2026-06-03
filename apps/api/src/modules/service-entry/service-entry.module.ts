import { Module } from '@nestjs/common';
import { ServiceEntryService } from '../../application/services/service-entry.service';
import { ServiceEntryController } from '../../interface/controllers/service-entry.controller';
import { SupabaseServiceEntryRepository } from '../../infrastructure/supabase/repositories/supabase-service-entry.repository';
import { SERVICE_ENTRY_REPOSITORY } from '../../domain/repositories/service-entry.repository.interface';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [RbacModule, NotificationModule],
  controllers: [ServiceEntryController],
  providers: [
    ServiceEntryService,
    {
      provide: SERVICE_ENTRY_REPOSITORY,
      useClass: SupabaseServiceEntryRepository,
    },
  ],
  exports: [ServiceEntryService, SERVICE_ENTRY_REPOSITORY],
})
export class ServiceEntryModule {}
