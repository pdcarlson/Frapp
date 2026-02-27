import { Module } from '@nestjs/common';
import { TaskService } from '../../application/services/task.service';
import { TaskController } from '../../interface/controllers/task.controller';
import { SupabaseTaskRepository } from '../../infrastructure/supabase/repositories/supabase-task.repository';
import { TASK_REPOSITORY } from '../../domain/repositories/task.repository.interface';
import { POINT_TRANSACTION_REPOSITORY } from '../../domain/repositories/point-transaction.repository.interface';
import { SupabasePointTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-point-transaction.repository';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [RbacModule],
  controllers: [TaskController],
  providers: [
    TaskService,
    { provide: TASK_REPOSITORY, useClass: SupabaseTaskRepository },
    {
      provide: POINT_TRANSACTION_REPOSITORY,
      useClass: SupabasePointTransactionRepository,
    },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
  exports: [TaskService, TASK_REPOSITORY],
})
export class TaskModule {}
