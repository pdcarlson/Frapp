import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  RequestDocumentUploadUrlDto,
  ConfirmDocumentUploadDto,
} from '../dtos/chapter-document.dto';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('documents')
export class ChapterDocumentController {
  constructor(
    private readonly chapterDocumentService: ChapterDocumentService,
  ) {}

  @Post('upload-url')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
  @ApiOperation({ summary: 'Get signed upload URL' })
  async requestUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestDocumentUploadUrlDto,
  ) {
    return this.chapterDocumentService.requestUploadUrl({
      chapterId,
      filename: dto.filename,
      contentType: dto.content_type,
    });
  }

  @Post()
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
  @ApiOperation({ summary: 'Confirm upload with metadata' })
  async confirmUpload(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmDocumentUploadDto,
  ) {
    return this.chapterDocumentService.confirmUpload({
      chapter_id: chapterId,
      title: dto.title,
      description: dto.description,
      folder: dto.folder,
      storage_path: dto.storage_path,
      uploaded_by: userId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List documents (optional folder filter)' })
  @ApiQuery({ name: 'folder', required: false })
  async list(
    @CurrentChapterId() chapterId: string,
    @Query('folder') folder?: string,
  ) {
    const filter =
      folder !== undefined
        ? { folder: folder === '' || folder === 'null' ? null : folder }
        : undefined;
    return this.chapterDocumentService.findByChapter(chapterId, filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document with download URL' })
  async getOne(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    return this.chapterDocumentService.findById(id, chapterId);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Delete a document' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.chapterDocumentService.delete(id, chapterId);
    return { success: true };
  }
}
