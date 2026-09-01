import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  RequestDocumentUploadUrlDto,
  ConfirmDocumentUploadDto,
  CreateDocumentFolderDto,
  UpdateDocumentFolderDto,
} from '../dtos/chapter-document.dto';

@ApiTags('Documents')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@RequireModule('documents')
@Controller('documents')
export class ChapterDocumentController {
  constructor(
    private readonly chapterDocumentService: ChapterDocumentService,
  ) {}

  @Post('upload-url')
  @ThrottleFanOutWrite()
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
      content_type: dto.content_type,
      byte_size: dto.byte_size,
      document_type: dto.document_type,
      effective_date: dto.effective_date,
    });
  }

  @Get()
  @ApiOperation({
    summary: 'List documents (optional folder and title search)',
  })
  @ApiQuery({ name: 'folder', required: false })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Case-insensitive substring match on the document title',
  })
  async list(
    @CurrentChapterId() chapterId: string,
    @Query('folder') folder?: string,
    @Query('search') search?: string,
  ) {
    const folderFilter =
      folder !== undefined
        ? { folder: folder === '' || folder === 'null' ? null : folder }
        : undefined;
    const searchFilter = search?.trim() ? { search: search.trim() } : undefined;
    const filter =
      folderFilter || searchFilter
        ? { ...folderFilter, ...searchFilter }
        : undefined;
    return this.chapterDocumentService.findByChapter(chapterId, filter);
  }

  // Folder routes are declared before `:id` on purpose — Nest matches in
  // declaration order, so `@Get(':id')` above would swallow `/documents/folders`
  // and try to load a document whose id is the literal string "folders".
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).

  @Get('folders')
  @ApiOperation({ summary: 'List document folders in display order' })
  async listFolders(@CurrentChapterId() chapterId: string) {
    return this.chapterDocumentService.listFolders(chapterId);
  }

  @Post('folders')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Create a document folder' })
  async createFolder(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateDocumentFolderDto,
  ) {
    return this.chapterDocumentService.createFolder(
      chapterId,
      dto.name,
      dto.sort_order,
    );
  }

  @Patch('folders/:id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Rename or reorder a document folder' })
  async updateFolder(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentFolderDto,
  ) {
    return this.chapterDocumentService.updateFolder(id, chapterId, {
      name: dto.name,
      sort_order: dto.sort_order,
    });
  }

  @Delete('folders/:id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({
    summary: 'Delete a folder (its documents move to the root level)',
  })
  async deleteFolder(
    @CurrentChapterId() chapterId: string,
    @Param('id') id: string,
  ) {
    await this.chapterDocumentService.deleteFolder(id, chapterId);
    return { success: true };
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
