import { Module } from '@nestjs/common';
import { ActPeopleResolver } from '../../application/services/act/act-people';
import { ACT_TOOLS } from '../../application/services/act/act-tool';
import {
  CreateEventActTool,
  CreateTaskActTool,
  GivePointsActTool,
} from '../../application/services/act/act-tools';
import { ActService } from '../../application/services/act/act.service';
import { ActController } from '../../interface/controllers/act.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AiSuggestionModule } from '../ai-suggestion/ai-suggestion.module';
import { AiModule } from '../ai/ai.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { EventModule } from '../event/event.module';
import { MemberModule } from '../member/member.module';
import { RbacModule } from '../rbac/rbac.module';

/**
 * Asking Frapp to do something (#718).
 *
 * A new action is a class added to the `ACT_TOOLS` list, with a suggestion
 * kind handler (`AiSuggestionModule`) that makes the change on confirm. The
 * list is closed: the planning call can only pick from it, and `ActService`
 * offers a member only the actions whose own route they could call.
 *
 * Nothing here calls a method that writes to the chapter: the tools read
 * (roster, events, attendance) and answer with a draft. Proposals are saved
 * and confirmed through `AiSuggestionModule`.
 */
@Module({
  imports: [
    AiModule,
    AiConsentModule,
    AiSuggestionModule,
    AnalyticsModule,
    RbacModule,
    MemberModule,
    EventModule,
    AttendanceModule,
  ],
  controllers: [ActController],
  providers: [
    ActService,
    ActPeopleResolver,
    AiEnabledGuard,
    GivePointsActTool,
    CreateTaskActTool,
    CreateEventActTool,
    {
      provide: ACT_TOOLS,
      useFactory: (
        points: GivePointsActTool,
        task: CreateTaskActTool,
        event: CreateEventActTool,
      ) => [points, task, event],
      inject: [GivePointsActTool, CreateTaskActTool, CreateEventActTool],
    },
  ],
})
export class ActModule {}
