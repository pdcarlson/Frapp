import { Module } from '@nestjs/common';
import { ServiceEntryService } from '../../application/services/service-entry.service';
import { ServiceEntryController } from '../../interface/controllers/service-entry.controller';
import { SupabaseServiceEntryRepository } from '../../infrastructure/supabase/repositories/supabase-service-entry.repository';
import { SERVICE_ENTRY_REPOSITORY } from '../../domain/repositories/service-entry.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [RbacModule],
  controllers: [ServiceEntryController],
  providers: [
    ServiceEntryService,
    { provide: SERVICE_ENTRY_REPOSITORY, useClass: SupabaseServiceEntryRepository },
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
  ],
  exports: [ServiceEntryService, SERVICE_ENTRY_REPOSITORY],
})
export class ServiceEntryModule {}
