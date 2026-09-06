import { Module } from '@nestjs/common';
import { ActivityFeedService } from '../../application/services/activity-feed.service';
import { ActivityFeedController } from '../../interface/controllers/activity-feed.controller';
import { EventModule } from '../event/event.module';
import { PointsModule } from '../points/points.module';
import { BackworkModule } from '../backwork/backwork.module';
import { MemberModule } from '../member/member.module';
import { ChatModule } from '../chat/chat.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  // One import per domain this feed reads through — no repository tokens of
  // its own, so every read stays behind each domain's existing service.
  // RbacModule → RbacService, for the backwork visibility check.
  imports: [
    EventModule,
    PointsModule,
    BackworkModule,
    MemberModule,
    ChatModule,
    RbacModule,
  ],
  controllers: [ActivityFeedController],
  providers: [ActivityFeedService],
})
export class ActivityFeedModule {}
