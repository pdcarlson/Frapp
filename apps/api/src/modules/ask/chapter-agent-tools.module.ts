import { Module } from '@nestjs/common';
import { CHAPTER_AGENT_TOOLS } from '../../application/services/ask/agent/tools-chapter';
// Each import is the module of a route these tools mirror, for the service
// that route calls.
import { ActivityModule } from '../activity/activity.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ChapterGroupModule } from '../chapter-group/chapter-group.module';
import { EventModule } from '../event/event.module';
import { FinancialInvoiceModule } from '../financial-invoice/financial-invoice.module';
import { MemberModule } from '../member/member.module';
import { PointsModule } from '../points/points.module';
import { RbacModule } from '../rbac/rbac.module';
import { ServiceEntryModule } from '../service-entry/service-entry.module';
import { TaskModule } from '../task/task.module';

/**
 * The tools Ask's agent loop reads the chapter's people, tasks, events and
 * standing with (#4901, epic #4898).
 *
 * It provides and exports the classes in `CHAPTER_AGENT_TOOLS` and nothing
 * else. Nothing imports it yet: the core slice (#4899) imports it into
 * `AskModule` and injects the list as `AGENT_READ_TOOLS`, which is when a
 * member can first reach one of these. Until then no route runs them.
 */
@Module({
  imports: [
    MemberModule,
    RbacModule,
    ChapterGroupModule,
    TaskModule,
    EventModule,
    AttendanceModule,
    PointsModule,
    ActivityModule,
    ServiceEntryModule,
    FinancialInvoiceModule,
  ],
  providers: [...CHAPTER_AGENT_TOOLS],
  exports: [...CHAPTER_AGENT_TOOLS],
})
export class ChapterAgentToolsModule {}
