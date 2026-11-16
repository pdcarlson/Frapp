import { Module } from '@nestjs/common';
import { BootstrapService } from '../../application/services/bootstrap.service';
import { BootstrapController } from '../../interface/controllers/bootstrap.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { AuthModule } from '../auth/auth.module';
import { ChapterModule } from '../chapter/chapter.module';
import { ChapterDocumentModule } from '../chapter-document/chapter-document.module';
import { ChatModule } from '../chat/chat.module';
import { ChatBlockModule } from '../chat-block/chat-block.module';
import { MemberModule } from '../member/member.module';
import { EventModule } from '../event/event.module';
import { NotificationModule } from '../notification/notification.module';
import { RbacModule } from '../rbac/rbac.module';
import { StudyModule } from '../study/study.module';
import { UserModule } from '../user/user.module';

/** `GET /v1/bootstrap` (#4709): reads from the modules whose routes it stands in for. */
@Module({
  imports: [
    AuthModule,
    ChapterDocumentModule,
    ChapterModule,
    ChatBlockModule,
    ChatModule,
    EventModule,
    MemberModule,
    NotificationModule,
    RbacModule,
    StudyModule,
    UserModule,
  ],
  controllers: [BootstrapController],
  providers: [AuthSyncInterceptor, BootstrapService],
})
export class BootstrapModule {}
