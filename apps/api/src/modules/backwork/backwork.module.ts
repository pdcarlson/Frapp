import { Module } from '@nestjs/common';
import { BackworkService } from '../../application/services/backwork.service';
import { BackworkController } from '../../interface/controllers/backwork.controller';
import { SupabaseBackworkResourceRepository } from '../../infrastructure/supabase/repositories/supabase-backwork-resource.repository';
import { SupabaseBackworkDepartmentRepository } from '../../infrastructure/supabase/repositories/supabase-backwork-department.repository';
import { SupabaseBackworkProfessorRepository } from '../../infrastructure/supabase/repositories/supabase-backwork-professor.repository';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';
import {
  BACKWORK_RESOURCE_REPOSITORY,
  BACKWORK_DEPARTMENT_REPOSITORY,
  BACKWORK_PROFESSOR_REPOSITORY,
} from '../../domain/repositories/backwork.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';

@Module({
  controllers: [BackworkController],
  providers: [
    BackworkService,
    {
      provide: BACKWORK_RESOURCE_REPOSITORY,
      useClass: SupabaseBackworkResourceRepository,
    },
    {
      provide: BACKWORK_DEPARTMENT_REPOSITORY,
      useClass: SupabaseBackworkDepartmentRepository,
    },
    {
      provide: BACKWORK_PROFESSOR_REPOSITORY,
      useClass: SupabaseBackworkProfessorRepository,
    },
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  exports: [BackworkService],
})
export class BackworkModule {}
