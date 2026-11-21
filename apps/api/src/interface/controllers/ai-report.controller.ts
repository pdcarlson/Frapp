import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AI_REPORT_RETENTION_DAYS } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import { AiReportService } from '../../application/services/ai/ai-report.service';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleExpensiveWrite } from '../decorators/throttle-profiles.decorator';
import {
  AiReportOutcomeDto,
  AiReportPolicyDto,
  CreateAiReportDto,
} from '../dtos/ai-report.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

/**
 * Report this (#4315, `spec/behavior/ai.md` § Stored AI text). There is no
 * route that reads a report: they are for the Frapp team, who read them
 * from the database with the key (`docs/ops/ai-stored-text.md`).
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available`, as for every AI route.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.AI_USE)
@Controller('ai/reports')
export class AiReportController {
  constructor(private readonly reports: AiReportService) {}

  @Get()
  @ApiOperation({
    summary: 'What a report keeps, for the sheet to say before it is sent',
  })
  @ApiOkResponse({ type: AiReportPolicyDto })
  @ApiNotFoundResponse({
    description: 'AI is off on this server (`ai.not_available`).',
  })
  policy(): AiReportPolicyDto {
    return {
      keeps_text: this.reports.keepsText(),
      retention_days: AI_REPORT_RETENTION_DAYS,
    };
  }

  @Post()
  @ThrottleExpensiveWrite()
  @ApiOperation({
    summary: 'Report something the AI made',
    description:
      'Keeps that one exchange, encrypted, for 30 days, for the Frapp team; then it is deleted. Without a sealing key on the server, only the reason and note are kept. A second report of the same thing by the same member keeps nothing new (`already_reported`).',
  })
  @ApiCreatedResponse({ type: AiReportOutcomeDto })
  @ApiBadRequestResponse({
    description:
      "A receipt (an Ask answer's or a summary's) that is too old (`ai.report.too_old`) or was not issued to the caller for this answer or summary (`ai.report.receipt_invalid`).",
  })
  @ApiNotFoundResponse({
    description:
      'AI is off (`ai.not_available`), or there is nothing the caller can see to report (`ai.report.not_found`).',
  })
  create(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentEnabledModules() enabledModules: Record<string, boolean> | null,
    @Body() dto: CreateAiReportDto,
  ): Promise<AiReportOutcomeDto> {
    return this.reports.report({
      chapterId,
      userId,
      enabledModules,
      subject: dto.subject,
      subjectId: dto.subject_id,
      reason: dto.reason,
      note: dto.note ?? null,
      receipt: dto.receipt ?? null,
    });
  }
}
