import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Param,
  ParseArrayPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { ChapterDocumentService } from '../../application/services/chapter-document.service';
import { ChapterDocumentTypeService } from '../../application/services/chapter-document-type.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequireAnyOfPermissions,
  RequirePermissions,
} from '../decorators/permissions.decorator';
import { RequireModule } from '../decorators/module.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  FeatureEvent,
  type FeatureEventInput,
  hasText,
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  RequestDocumentUploadUrlDto,
  DocumentUploadUrlResponseDto,
  ConfirmDocumentUploadDto,
  CreateDocumentFolderDto,
  UpdateDocumentFolderDto,
  DocumentStarsDto,
  ChapterDocumentDto,
  DocumentFolderDto,
  DocumentPreviewUrlDto,
  CreateDocumentTypeDto,
  RequestDocumentUploadUrlsDto,
  DocumentUploadUrlsResponseDto,
  ConfirmDocumentUploadsDto,
  DocumentConfirmResultsDto,
  UpdateDocumentTypeDto,
  DocumentTypeDto,
  DocumentAccessOptionsDto,
  SetDocumentAccessDto,
  UpdateDocumentDto,
  MoveDocumentsDto,
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
    private readonly chapterDocumentTypeService: ChapterDocumentTypeService,
  ) {}

  @Post('upload-url')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
  @ApiOperation({ summary: 'Get signed upload URL' })
  @ApiCreatedResponse({ type: DocumentUploadUrlResponseDto })
  async requestUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestDocumentUploadUrlDto,
  ): Promise<DocumentUploadUrlResponseDto> {
    // Same mapping as BackworkController.requestUploadUrl — the service
    // returns camelCase; the dashboard reads snake_case. Passthrough made a
    // successful mint look like a missing ticket.
    const ticket = await this.chapterDocumentService.requestUploadUrl({
      chapterId,
      filename: dto.filename,
      contentType: dto.content_type,
      sizeBytes: dto.size_bytes,
    });
    if (!ticket.signedUrl || !ticket.storagePath) {
      throw new InternalServerErrorException(
        'Storage did not return a signed upload URL or storage path.',
      );
    }
    return {
      upload_url: ticket.signedUrl,
      storage_path: ticket.storagePath,
      document_id: ticket.documentId,
    };
  }

  @Post('upload-urls')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
  @ApiOperation({
    summary: 'Get signed upload URLs for up to 25 files (folder import)',
  })
  @ApiCreatedResponse({ type: DocumentUploadUrlsResponseDto })
  async requestUploadUrls(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestDocumentUploadUrlsDto,
  ): Promise<DocumentUploadUrlsResponseDto> {
    const tickets = await this.chapterDocumentService.requestUploadUrls(
      chapterId,
      dto.files.map((file) => ({
        filename: file.filename,
        contentType: file.content_type,
        sizeBytes: file.size_bytes,
      })),
    );
    if (tickets.some((ticket) => !ticket.signedUrl || !ticket.storagePath)) {
      throw new InternalServerErrorException(
        'Storage did not return a signed upload URL or storage path.',
      );
    }
    return {
      tickets: tickets.map((ticket) => ({
        upload_url: ticket.signedUrl,
        storage_path: ticket.storagePath,
        document_id: ticket.documentId,
      })),
    };
  }

  @Post('batch')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
  @ApiOperation({
    summary:
      'Confirm up to 25 uploads with metadata (folder import); each succeeds or fails on its own',
  })
  @ApiCreatedResponse({ type: DocumentConfirmResultsDto })
  @FeatureEvent(
    'documents-imported',
    ({
      result,
    }: FeatureEventInput<
      ConfirmDocumentUploadsDto,
      DocumentConfirmResultsDto
    >) => {
      // Counted from what was filed, not what was sent: a document the
      // service refused on its own isn't an import.
      const filed = (Array.isArray(result?.results) ? result.results : [])
        .map((entry) => entry?.document)
        .filter((doc): doc is ChapterDocumentDto => Boolean(doc));
      return {
        count: filed.length,
        typed_count: filed.filter((doc) => hasText(doc.document_type)).length,
        filed_count: filed.filter((doc) => hasText(doc.folder)).length,
      };
    },
  )
  async confirmUploads(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmDocumentUploadsDto,
  ): Promise<DocumentConfirmResultsDto> {
    const results = await this.chapterDocumentService.confirmUploads(
      dto.documents.map((doc) => ({
        chapter_id: chapterId,
        title: doc.title,
        description: doc.description,
        folder: doc.folder,
        storage_path: doc.storage_path,
        uploaded_by: userId,
        content_type: doc.content_type,
        byte_size: doc.byte_size,
        document_type: doc.document_type,
        effective_date: doc.effective_date,
        who_can_see: doc.who_can_see,
      })),
    );
    return { results };
  }

  @Post()
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_UPLOAD)
  @ApiOperation({ summary: 'Confirm upload with metadata' })
  @FeatureEvent(
    'document-uploaded',
    ({ body }: FeatureEventInput<ConfirmDocumentUploadDto>) => ({
      // Both are free text, so only their presence is sent.
      has_document_type: hasText(body.document_type),
      has_folder: hasText(body.folder),
    }),
  )
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
      who_can_see: dto.who_can_see,
    });
  }

  // Before `:id` routes, though no other POST would take it. The service
  // checks each file: its uploader, or a member who manages documents.
  @Post('move')
  @HttpCode(200)
  @ThrottleFanOutWrite()
  @ApiOperation({
    summary:
      'Move up to 200 documents into one folder; if one may not move, none does (not copies from the Google Drive folder)',
  })
  @ApiOkResponse({ type: ChapterDocumentDto, isArray: true })
  async move(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MoveDocumentsDto,
  ): Promise<ChapterDocumentDto[]> {
    return this.chapterDocumentService.moveDocuments(
      dto.document_ids,
      chapterId,
      userId,
      dto.folder,
    );
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
  @ApiOkResponse({ type: ChapterDocumentDto, isArray: true })
  async list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
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
    return this.chapterDocumentService.findByChapter(chapterId, userId, filter);
  }

  // Type routes, like the folder routes below, are declared before `:id` so
  // `@Get(':id')` doesn't take `/documents/types` for a document id.

  @Get('types')
  @ApiOperation({
    summary: "List the chapter's document types in display order",
  })
  @ApiOkResponse({ type: DocumentTypeDto, isArray: true })
  async listTypes(
    @CurrentChapterId() chapterId: string,
  ): Promise<DocumentTypeDto[]> {
    return this.chapterDocumentTypeService.list(chapterId);
  }

  @Post('types')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Add a document type' })
  @ApiCreatedResponse({ type: DocumentTypeDto })
  async createType(
    @CurrentChapterId() chapterId: string,
    @Body() dto: CreateDocumentTypeDto,
  ): Promise<DocumentTypeDto> {
    return this.chapterDocumentTypeService.create(
      chapterId,
      dto.name,
      dto.sort_order,
    );
  }

  @Patch('types/:id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({
    summary:
      'Rename or reorder a document type (a rename renames it on its documents)',
  })
  @ApiOkResponse({ type: DocumentTypeDto })
  async updateType(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentTypeDto,
  ): Promise<DocumentTypeDto> {
    return this.chapterDocumentTypeService.update(id, chapterId, {
      name: dto.name,
      sort_order: dto.sort_order,
    });
  }

  @Delete('types/:id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({
    summary: 'Delete a document type (its documents keep everything else)',
  })
  async deleteType(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.chapterDocumentTypeService.delete(id, chapterId);
    return { success: true };
  }

  // Folder routes are declared before `:id` on purpose — Nest matches in
  // declaration order, so `@Get(':id')` above would swallow `/documents/folders`
  // and try to load a document whose id is the literal string "folders".
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).

  // Signed links for the web grid's previews (#4647), many in one request so
  // a grid spends one read, not one per tile, of the member's read budget.
  // No `@FeatureEvent`: a tile coming into view isn't a member opening the
  // file, which is what `document-viewed` counts (observability.md).
  @Get('previews')
  @ApiOperation({
    summary: 'Inline preview links for up to 100 documents at once',
  })
  @ApiQuery({
    name: 'ids',
    required: true,
    description:
      'Document ids, at most 100: the parameter repeated, or one comma-separated value',
  })
  @ApiOkResponse({ type: DocumentPreviewUrlDto, isArray: true })
  async previewUrls(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Query('ids', new ParseArrayPipe({ items: String, separator: ',' }))
    ids: string[],
  ): Promise<DocumentPreviewUrlDto[]> {
    if (ids.some((id) => !isUUID(id))) {
      throw new BadRequestException('ids must be document ids');
    }
    return this.chapterDocumentService.previewUrls(ids, chapterId, userId);
  }

  @Get('folders')
  @ApiOperation({ summary: 'List document folders in display order' })
  @ApiOkResponse({ type: DocumentFolderDto, isArray: true })
  async listFolders(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chapterDocumentService.listFolders(chapterId, userId);
  }

  // Who can see (#3642 piece 1): what the picker offers, for anyone who sets
  // a list: an uploader (a file's list is theirs) or whoever manages
  // documents (a folder's list, and any file's), who need not hold upload.
  // Before `:id` like the folder routes, so it isn't read as a document id.
  @Get('access-options')
  @RequireAnyOfPermissions(
    SystemPermissions.CHAPTER_DOCS_UPLOAD,
    SystemPermissions.CHAPTER_DOCS_MANAGE,
  )
  @ApiOperation({
    summary:
      "What a who-can-see list may hold, and the tiers the caller's lists always keep",
  })
  @ApiOkResponse({ type: DocumentAccessOptionsDto })
  async accessOptions(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<DocumentAccessOptionsDto> {
    return this.chapterDocumentService.accessOptions(chapterId, userId);
  }

  // Pins are chapter-wide and need `chapter_docs:manage`, the permission that
  // already creates, renames and reorders folders. Stars are each member's
  // own and need only the class-level read permission (#3934).

  @Get('stars')
  @ApiOperation({
    summary: "The caller's own starred folders and documents",
  })
  @ApiOkResponse({ type: DocumentStarsDto })
  async listStars(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<DocumentStarsDto> {
    return this.chapterDocumentService.listStars(userId, chapterId);
  }

  @Post('folders')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Create a document folder' })
  async createFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDocumentFolderDto,
  ) {
    return this.chapterDocumentService.createFolder(
      chapterId,
      dto.name,
      dto.sort_order,
      userId,
      dto.who_can_see,
    );
  }

  @Patch('folders/:id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({
    summary: 'Rename or reorder a document folder, or set who can see it',
  })
  async updateFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentFolderDto,
  ) {
    return this.chapterDocumentService.updateFolder(id, chapterId, userId, {
      name: dto.name,
      sort_order: dto.sort_order,
      who_can_see: dto.who_can_see,
    });
  }

  @Delete('folders/:id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({
    summary: 'Delete a folder (its documents move to the root level)',
  })
  async deleteFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.chapterDocumentService.deleteFolder(id, chapterId, userId);
    return { success: true };
  }

  @Put('folders/:id/pin')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Pin a folder for the whole chapter (idempotent)' })
  @ApiOkResponse({ type: DocumentFolderDto })
  async pinFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentFolderDto> {
    return this.chapterDocumentService.setFolderPinned(
      id,
      chapterId,
      userId,
      true,
    );
  }

  @Delete('folders/:id/pin')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Unpin a folder (idempotent)' })
  @ApiOkResponse({ type: DocumentFolderDto })
  async unpinFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentFolderDto> {
    return this.chapterDocumentService.setFolderPinned(
      id,
      chapterId,
      userId,
      false,
    );
  }

  @Put('folders/:id/star')
  @HttpCode(204)
  @ApiOperation({ summary: 'Star a folder for yourself (idempotent)' })
  @ApiNoContentResponse()
  async starFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.chapterDocumentService.setFolderStarred(
      userId,
      chapterId,
      id,
      true,
    );
  }

  @Delete('folders/:id/star')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove your star from a folder (idempotent)' })
  @ApiNoContentResponse()
  async unstarFolder(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.chapterDocumentService.setFolderStarred(
      userId,
      chapterId,
      id,
      false,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document with download URL' })
  @FeatureEvent('document-viewed')
  async getOne(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chapterDocumentService.findById(id, chapterId, userId);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Delete a document' })
  async delete(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.chapterDocumentService.delete(id, chapterId, userId);
    return { success: true };
  }

  // Like who sees it, a file is renamed and refiled by its uploader or by
  // whoever manages documents; the service checks which.
  @Patch(':id')
  @ApiOperation({
    summary:
      'Rename a document or move it to another folder (not a copy from the Google Drive folder)',
  })
  @ApiOkResponse({ type: ChapterDocumentDto })
  async update(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<ChapterDocumentDto> {
    return this.chapterDocumentService.updateDocument(id, chapterId, userId, {
      title: dto.title,
      folder: dto.folder,
    });
  }

  // A file's own list is set by its uploader within its folder, or by whoever
  // manages documents (Paul's pick 5); the service checks which, since the
  // uploader needs no permission beyond seeing the file.
  @Put(':id/access')
  @ApiOperation({ summary: 'Set who can see one document' })
  @ApiOkResponse({ type: ChapterDocumentDto })
  async setAccess(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDocumentAccessDto,
  ): Promise<ChapterDocumentDto> {
    return this.chapterDocumentService.setDocumentAccess(
      id,
      chapterId,
      userId,
      dto.who_can_see ?? null,
    );
  }

  @Put(':id/pin')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({
    summary: 'Pin a document for the whole chapter (idempotent)',
  })
  @ApiOkResponse({ type: ChapterDocumentDto })
  async pinDocument(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChapterDocumentDto> {
    return this.chapterDocumentService.setDocumentPinned(
      id,
      chapterId,
      userId,
      true,
    );
  }

  @Delete(':id/pin')
  @RequirePermissions(SystemPermissions.CHAPTER_DOCS_MANAGE)
  @ApiOperation({ summary: 'Unpin a document (idempotent)' })
  @ApiOkResponse({ type: ChapterDocumentDto })
  async unpinDocument(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChapterDocumentDto> {
    return this.chapterDocumentService.setDocumentPinned(
      id,
      chapterId,
      userId,
      false,
    );
  }

  @Put(':id/star')
  @HttpCode(204)
  @ApiOperation({ summary: 'Star a document for yourself (idempotent)' })
  @ApiNoContentResponse()
  async starDocument(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.chapterDocumentService.setDocumentStarred(
      userId,
      chapterId,
      id,
      true,
    );
  }

  @Delete(':id/star')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove your star from a document (idempotent)' })
  @ApiNoContentResponse()
  async unstarDocument(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.chapterDocumentService.setDocumentStarred(
      userId,
      chapterId,
      id,
      false,
    );
  }
}
