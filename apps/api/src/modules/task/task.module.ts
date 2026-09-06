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

@Module({
  // ChatModule → ChatService (posts the /task card); AuthModule → USER_REPOSITORY
  // (resolves assigner/assignee display names embedded in the card payload).
  imports: [RbacModule, NotificationModule, ChatModule, AuthModule],
  controllers: [TaskController],
  providers: [
    TaskService,
    { provide: TASK_REPOSITORY, useClass: SupabaseTaskRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
  ],
})
export class TaskModule {}
