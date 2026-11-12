import { Module } from '@nestjs/common';
import { TaskService } from '../../application/services/task.service';
import { TaskController } from '../../interface/controllers/task.controller';
import { SupabaseTaskRepository } from '../../infrastructure/supabase/repositories/supabase-task.repository';
import { TASK_REPOSITORY } from '#domain/repositories/task.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationModule } from '../notification/notification.module';
import { ChatModule } from '../chat/chat.module';
import { AuthModule } from '../auth/auth.module';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SupabaseStorageService } from '../../infrastructure/storage/supabase-storage.service';

@Module({
  // ChatModule → ChatService (posts the /task card); AuthModule → USER_REPOSITORY
  // (resolves assigner/assignee display names embedded in the card payload).
  imports: [RbacModule, NotificationModule, ChatModule, AuthModule],
  controllers: [TaskController],
  providers: [
    TaskService,
    { provide: TASK_REPOSITORY, useClass: SupabaseTaskRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    // Task photos (#4565).
    { provide: STORAGE_PROVIDER, useClass: SupabaseStorageService },
  ],
  // ActivityModule reads tasks through the service (#3897).
  exports: [TaskService],
})
export class TaskModule {}
