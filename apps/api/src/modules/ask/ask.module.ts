import { Module } from '@nestjs/common';
import { AgentLoopService } from '../../application/services/ask/agent/agent-loop.service';
import {
  AGENT_READ_TOOLS,
  type AgentReadTool,
} from '../../application/services/ask/agent/agent-tool';
import { CHAPTER_AGENT_TOOLS } from '../../application/services/ask/agent/tools-chapter';
import { CONVERSATION_AGENT_TOOLS } from '../../application/services/ask/agent/tools-conversations';
import { AskDiagnosticsService } from '../../application/services/ask/ask-diagnostics.service';
import {
  ASK_TOOLS,
  type AskTool,
} from '../../application/services/ask/ask-tool';
import { ASK_TOOL_CLASSES } from '../../application/services/ask/ask-tools';
import { AskConversationService } from '../../application/services/ask/ask-conversation.service';
import { AskSuggestionsService } from '../../application/services/ask/ask-suggestions.service';
import { AskService } from '../../application/services/ask/ask.service';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { AskDiagnosticsSweepService } from '../../application/workers/ask-diagnostics-sweep.service';
import {
  AskController,
  AskDiagnosticsStopController,
} from '../../interface/controllers/ask.controller';
import { AiEnabledGuard } from '../../interface/guards/ai-enabled.guard';
import { SupabaseAskDiagnosticsRepository } from '../../infrastructure/supabase/repositories/supabase-ask-diagnostics.repository';
import { SupabaseChapterAuditLogRepository } from '../../infrastructure/supabase/repositories/supabase-chapter-audit-log.repository';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { ASK_DIAGNOSTICS_REPOSITORY } from '#domain/repositories/ask-diagnostics.repository.interface';
import { CHAPTER_AUDIT_LOG_REPOSITORY } from '#domain/repositories/chapter-audit-log.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { ActModule } from '../act/act.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AiConsentModule } from '../ai-consent/ai-consent.module';
import { AiModule } from '../ai/ai.module';
import { AskConversationToolsModule } from '../ask-conversation-tools/ask-conversation-tools.module';
import { AskObserveModule } from '../ask-observe/ask-observe.module';
import { ChapterAgentToolsModule } from './chapter-agent-tools.module';
import { CorpusModule } from '../corpus/corpus.module';
import { EventModule } from '../event/event.module';
import { FinancialInvoiceModule } from '../financial-invoice/financial-invoice.module';
import { MeetingModule } from '../meeting/meeting.module';
import { MemberModule } from '../member/member.module';
import { PointsModule } from '../points/points.module';
import { RbacModule } from '../rbac/rbac.module';
import { TaskModule } from '../task/task.module';

/**
 * Ask Frapp (#450, #451) and its beta diagnostics window (#4315).
 *
 * A new live-data tool is a class added to `ASK_TOOL_CLASSES`
 * (`ask-tools.ts`), which is the whole of what `ASK_TOOLS` provides. The list
 * is closed: the plan step can only pick from it, and `AskService` checks
 * each pick against the asker's permissions before it runs. A tool also
 * needs its words for the line under a working turn (`ASK_COPY.reads` in
 * `@repo/validation`, "Reading the roster"); `ask-tools.spec.ts` holds every
 * class in that list to it.
 *
 * `AskSuggestionsService` builds what Ask opens with (#4700) from the same
 * services the tools read through; it calls no model.
 *
 * `AskConversationService` is what the route calls: it runs a question
 * through `AskService` and, for a client that shows proposal cards, through
 * `ActService` (`ActModule`) beside it.
 */
@Module({
  imports: [
    AiModule,
    CorpusModule,
    AiConsentModule,
    RbacModule,
    MemberModule,
    EventModule,
    PointsModule,
    FinancialInvoiceModule,
    TaskModule,
    MeetingModule,
    ActModule,
    AnalyticsModule,
    // The tool loop's reads, and the trace it leaves of each turn.
    AskConversationToolsModule,
    ChapterAgentToolsModule,
    AskObserveModule,
  ],
  controllers: [AskController, AskDiagnosticsStopController],
  providers: [
    AskService,
    AskConversationService,
    AskSuggestionsService,
    AskDiagnosticsService,
    AskDiagnosticsSweepService,
    AiEnabledGuard,
    ...ASK_TOOL_CLASSES,
    {
      provide: ASK_TOOLS,
      useFactory: (...tools: AskTool[]) => tools,
      inject: [...ASK_TOOL_CLASSES],
    },
    // The tool loop (epic #4898), off unless `ASK_AGENT=on`. What it may
    // read is these two lists and nothing else, in the order a model is
    // shown them: conversations and records, then people, tasks, events and
    // standing. `AskService` offers a member only the ones they may use.
    AgentLoopService,
    {
      provide: AGENT_READ_TOOLS,
      useFactory: (...tools: AgentReadTool[]) => tools,
      inject: [...CONVERSATION_AGENT_TOOLS, ...CHAPTER_AGENT_TOOLS],
    },
    {
      provide: ASK_DIAGNOSTICS_REPOSITORY,
      useClass: SupabaseAskDiagnosticsRepository,
    },
    // The window is the president's to start and stop, and both are audited.
    { provide: ROLE_REPOSITORY, useClass: SupabaseRoleRepository },
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
    { provide: MEMBER_REPOSITORY, useClass: SupabaseMemberRepository },
    ChapterAuditLogService,
    {
      provide: CHAPTER_AUDIT_LOG_REPOSITORY,
      useClass: SupabaseChapterAuditLogRepository,
    },
  ],
})
export class AskModule {}
