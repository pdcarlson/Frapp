import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChapterAuditLogService } from '../../application/services/chapter-audit-log.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import {
  ChapterAuditLogEntryDto,
  ListChapterAuditLogQueryDto,
} from '../dtos/chapter-audit-log.dto';
import { SystemPermissions } from '#domain/constants/permissions';

@ApiTags('Chapter Audit Log')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
// Same base gate as the other settings/trust surfaces (custom-role,
// custom-field, chapter-config): `chapter-config:view`. The route additionally
// requires `members:view` below — PermissionsGuard merges class-level and
// route-level @RequirePermissions as an AND, not an OR — because this log now
// carries member_removed entries (actor + target user id), and a custom role
// scoped to chapter settings but not to the roster should not be able to read
// who removed whom.
@RequirePermissions(SystemPermissions.CHAPTER_CONFIG_VIEW)
@Controller('audit-log')
export class ChapterAuditLogController {
  constructor(private readonly auditLogService: ChapterAuditLogService) {}

  @Get()
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @ApiOperation({
    summary: 'List chapter audit log entries',
    description:
      'Officer-action history (config changes, role/field changes, member removal, and similar). Paginate via a cursor (`before` ISO8601). Returns newest-first, capped at `limit` (default 50, max 200).',
  })
  @ApiOkResponse({ type: ChapterAuditLogEntryDto, isArray: true })
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
