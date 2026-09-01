import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { ListChapterAuditLogQueryDto } from '../dtos/chapter-audit-log.dto';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Chapter Audit Log')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
// Same gate as the other settings/trust surfaces this log covers today
// (custom-role, custom-field, chapter-config) — no new permission, and no
// new "who besides the president can see this" decision to make.
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@Controller('audit-log')
export class ChapterAuditLogController {
  constructor(private readonly auditLogService: ChapterAuditLogService) {}

  @Get()
  @ApiOperation({
    summary: 'List chapter audit log entries',
    description:
      'Officer-action history (config changes, role/field changes, member removal, and similar). Paginate via a cursor (`before` ISO8601). Returns newest-first, capped at `limit` (default 50, max 200).',
  })
  async list(
    @CurrentChapterId() chapterId: string,
    @Query() query: ListChapterAuditLogQueryDto,
  ) {
    return this.auditLogService.list(chapterId, {
      before: query.before,
      limit: query.limit,
    });
  }
}
