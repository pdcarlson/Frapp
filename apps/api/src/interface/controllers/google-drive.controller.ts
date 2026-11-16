import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GoogleDriveService } from '../../application/services/google-drive/google-drive.service';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { SubscriptionExempt } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ConnectGoogleDriveDto,
  GoogleDriveStatusDto,
} from '../dtos/google-drive.dto';
import { ChapterDocumentDto } from '../dtos/chapter-document.dto';

/**
 * The chapter's connected Google Drive folder (#5157;
 * `spec/behavior/chapter-docs.md` § Google Drive folder). Its own path, not
 * under `/documents`, where `GET /documents/:id` would take `drive`.
 *
 * Every route takes Manage documents, reading too: a member sees where a copy
 * came from on its row, and the folder's id stays with the officers who
 * manage it. Disconnect is `@SubscriptionExempt()`: an officer can always
 * stop Frapp reading the folder.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
@RequireModule('documents')
@Controller('google-drive')
export class GoogleDriveController {
  constructor(
    private readonly drive: GoogleDriveService,
    private readonly documents: ChapterDocumentService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "Whether Google Drive is offered here, and the chapter's connected folder.",
  })
  @ApiOkResponse({ type: GoogleDriveStatusDto })
  status(@CurrentChapterId() chapterId: string): Promise<GoogleDriveStatusDto> {
    return this.drive.status(chapterId);
  }

  @Put()
  @ApiOperation({
    summary:
      'Connect a Google Drive folder shared with Frapp; its files are copied into Documents and kept in sync.',
  })
  @ApiOkResponse({ type: GoogleDriveStatusDto })
  connect(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() body: ConnectGoogleDriveDto,
  ): Promise<GoogleDriveStatusDto> {
    return this.drive.connect(
      chapterId,
      userId,
      body.folder_link,
      body.who_can_see ?? null,
    );
  }

  @Post('copies/:id/open-up')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Move a Drive copy that sync held back into the folder Drive put it in, which more people may see.',
  })
  @ApiOkResponse({ type: ChapterDocumentDto })
  openUp(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChapterDocumentDto> {
    return this.documents.openUpDriveCopy(id, chapterId, userId);
  }

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sync the connected folder now.' })
  @ApiOkResponse({ type: GoogleDriveStatusDto })
  syncNow(
    @CurrentChapterId() chapterId: string,
  ): Promise<GoogleDriveStatusDto> {
    return this.drive.syncNow(chapterId);
  }

  @Delete()
  @HttpCode(204)
  @SubscriptionExempt()
  @ApiOperation({
    summary:
      'Disconnect the folder. Its copies leave Documents; the files in Drive are untouched.',
  })
  @ApiNoContentResponse()
  async disconnect(@CurrentChapterId() chapterId: string): Promise<void> {
    await this.drive.disconnect(chapterId);
  }
}
