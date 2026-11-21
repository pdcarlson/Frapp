import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GoogleDriveLinkService } from '../../application/services/google-drive/google-drive-link.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  AddGoogleDriveLinkDto,
  GoogleDriveLinkInfoDto,
} from '../dtos/google-drive.dto';
import { ChapterDocumentDto } from '../dtos/chapter-document.dto';

/**
 * One Google Drive file added to Documents by its link (#5434;
 * `spec/behavior/chapter-docs.md` § Google Drive file by link). Its own path,
 * not under `/documents`, where `GET /documents/:id` would take it, nor under
 * `/google-drive`, whose routes all take Manage documents: adding a file is
 * an upload, so it takes `chapter_docs:upload`, as uploading does.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
@RequireModule('documents')
@Controller('google-drive-links')
export class GoogleDriveLinkController {
  constructor(private readonly links: GoogleDriveLinkService) {}

  @Get()
  @ApiOperation({
    summary:
      'Whether a Google Drive file can be added by link here, and the address to share one with.',
  })
  @ApiOkResponse({ type: GoogleDriveLinkInfoDto })
  info(): GoogleDriveLinkInfoDto {
    return this.links.info();
  }

  @Post()
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary:
      'Add one Google Drive file by its link. It is copied into Documents now and kept matching Drive.',
  })
  @ApiCreatedResponse({ type: ChapterDocumentDto })
  add(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() body: AddGoogleDriveLinkDto,
  ): Promise<ChapterDocumentDto> {
    return this.links.add(chapterId, userId, body);
  }

  @Post(':documentId/sync')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Check a linked document against Google Drive now.',
  })
  @ApiNoContentResponse()
  async syncNow(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ): Promise<void> {
    await this.links.syncNow(documentId, chapterId, userId);
  }
}
