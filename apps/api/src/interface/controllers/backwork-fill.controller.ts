import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SystemPermissions } from '#domain/constants/permissions';
import { BackworkFillService } from '../../application/services/backwork-fill/backwork-fill.service';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import { BackworkDraftFillResponseDto } from '../dtos/backwork.dto';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

/**
 * The upload-time AI fill for one backwork draft (#5233,
 * `spec/behavior/backwork.md` § AI fill).
 *
 * `AiEnabledGuard` first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available` and the web app hides the fill. Then the member, their
 * chapter, and `backwork:upload`: the draft must be the caller's own. The
 * chapter's Frapp AI switch and the member's answer on the AI sheet are the
 * service's checks.
 */
@ApiTags('Backwork')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
@RequireModule('backwork')
@Controller('backwork')
export class BackworkFillController {
  constructor(private readonly fillService: BackworkFillService) {}

  @Post('drafts/:id/fill')
  @HttpCode(200)
  // 10/min, the same as `POST /v1/backwork/upload-url`: drafts can't arrive
  // faster than files can be uploaded, so the review table's fill keeps pace
  // with a bulk upload, and a backlog from an earlier visit is filled over a
  // few minutes (the table waits and retries on a 429).
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary:
      "Propose fields for one of the caller's drafts from its redacted text",
    description:
      "Reads only a redacted draft's stored file, the flattened copy whose text layer holds only the words outside its redaction boxes, and never its file name. A draft uploaded as-is answers `not_redacted`, and one saved with suggested boxes its uploader has not checked yet answers `not_checked`; neither is read. Sets only fields the draft does not have yet; the uploader checks every value before publishing. A file over 25 MB, or a draft already marked `unreadable`, answers `unreadable` without its file being read. One fill at a time per draft: a second while one runs answers 409. 10 requests a minute per member; the AI spend caps bound the model cost.",
  })
  @ApiOkResponse({ type: BackworkDraftFillResponseDto })
  @ApiForbiddenResponse({
    description:
      'The caller has not said yes on the AI sheet (`ai.consent.required`), or the president has Frapp AI turned off (`ai.chapter_off`).',
  })
  @ApiConflictResponse({
    description: 'Another fill of this draft is still running.',
  })
  @ApiNotFoundResponse({
    description:
      "AI is off on this server (`ai.not_available`), or the draft is not the caller's or is gone.",
  })
  async fill(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BackworkDraftFillResponseDto> {
    // The member left the page: stop the model call and its spend.
    const abort = new AbortController();
    response.on('close', () => abort.abort());
    if (response.destroyed) abort.abort();
    return this.fillService.fill({
      chapterId,
      userId,
      draftId: id,
      signal: abort.signal,
    });
  }
}
