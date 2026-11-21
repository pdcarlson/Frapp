import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  InternalServerErrorException,
  Param,
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
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { BackworkService } from '../../application/services/backwork.service';
import { RbacService } from '../../application/services/rbac.service';
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
} from '../decorators/feature-event.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  RequestBackworkUploadUrlDto,
  BackworkUploadUrlResponseDto,
  ConfirmBackworkUploadDto,
  UpdateDepartmentDto,
  UpdateProfessorDto,
  MergeBackworkTaxonomyDto,
  MergeBackworkTaxonomyResponseDto,
  BackworkDownloadUrlsQueryDto,
  BackworkDownloadUrlsResponseDto,
  BackworkCourseDto,
  UpsertBackworkCourseDto,
  UpdateBackworkDraftsDto,
  PublishBackworkDraftsDto,
  PublishBackworkDraftsResponseDto,
  CheckBackworkDraftDto,
  BackworkDraftFileUrlDto,
} from '../dtos/backwork.dto';

@ApiTags('Backwork')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequireAnyOfPermissions(
  SystemPermissions.BACKWORK_UPLOAD,
  SystemPermissions.BACKWORK_ADMIN,
)
@RequireModule('backwork')
@Controller('backwork')
export class BackworkController {
  constructor(
    private readonly backworkService: BackworkService,
    private readonly rbacService: RbacService,
  ) {}

  @Post('upload-url')
  @ThrottleFanOutWrite()
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({ summary: 'Request a signed upload URL' })
  @ApiCreatedResponse({ type: BackworkUploadUrlResponseDto })
  async requestUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestBackworkUploadUrlDto,
  ): Promise<BackworkUploadUrlResponseDto> {
    // The service ticket is camelCase. The dashboard (and Discord's sibling
    // upload tickets) read snake_case `upload_url` / `storage_path`. Passing
    // the service object through produced a 201 whose body the client treated
    // as empty — staging toast "Upload URL response missing signed URL or
    // storage path."
    const ticket = await this.backworkService.requestUploadUrl({
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
      resource_id: ticket.resourceId,
    };
  }

  @Post()
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({ summary: 'Confirm upload and store resource metadata' })
  @FeatureEvent(
    'backwork-uploaded',
    ({ body }: FeatureEventInput<ConfirmBackworkUploadDto>) => ({
      // A closed `@IsIn(ASSIGNMENT_TYPES)` set, so safe to send as a value.
      assignment_type: body.assignment_type ?? null,
      is_redacted: body.is_redacted === true,
      tag_count: Array.isArray(body.tags) ? body.tags.length : 0,
    }),
  )
  async confirmUpload(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmBackworkUploadDto,
  ) {
    return this.backworkService.confirmUpload({
      // Server-decided keys last — see the note in event.controller.ts.
      ...dto,
      chapter_id: chapterId,
      uploader_id: userId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Browse/search backwork resources' })
  @ApiQuery({ name: 'department_id', required: false })
  @ApiQuery({ name: 'professor_id', required: false })
  @ApiQuery({ name: 'course_number', required: false })
  @ApiQuery({ name: 'year', required: false, type: Number })
  @ApiQuery({ name: 'semester', required: false })
  @ApiQuery({ name: 'assignment_type', required: false })
  @ApiQuery({ name: 'document_variant', required: false })
  @ApiQuery({ name: 'search', required: false })
  async list(
    @CurrentChapterId() chapterId: string,
    @Query('department_id') departmentId?: string,
    @Query('professor_id') professorId?: string,
    @Query('course_number') courseNumber?: string,
    @Query('year') year?: number,
    @Query('semester') semester?: string,
    @Query('assignment_type') assignmentType?: string,
    @Query('document_variant') documentVariant?: string,
    @Query('search') search?: string,
  ) {
    return this.backworkService.findByChapter(chapterId, {
      department_id: departmentId,
      professor_id: professorId,
      course_number: courseNumber,
      year,
      semester,
      assignment_type: assignmentType,
      document_variant: documentVariant,
      search,
    });
  }

  // Drafts (#5208). Every route here is the caller's own drafts only, so
  // `backwork:upload` is the gate and ownership is checked in the query. MUST
  // stay above `@Get(':id')`/`@Delete(':id')`, like `departments` below.
  @Get('drafts')
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({ summary: "The caller's backwork drafts, in upload order" })
  async listDrafts(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.backworkService.findDrafts(chapterId, userId);
  }

  @Patch('drafts')
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({
    summary: "Set fields on several of the caller's drafts at once",
  })
  async updateDrafts(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateBackworkDraftsDto,
  ) {
    return this.backworkService.updateDrafts(
      chapterId,
      userId,
      dto.ids,
      dto.fields,
    );
  }

  @Post('drafts/publish')
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({
    summary: "File the caller's drafts; ones that can't be filed stay drafts",
  })
  @ApiCreatedResponse({ type: PublishBackworkDraftsResponseDto })
  @FeatureEvent(
    'backwork-drafts-published',
    ({
      result,
    }: FeatureEventInput<
      PublishBackworkDraftsDto,
      PublishBackworkDraftsResponseDto
    >) => ({
      // Counted from the response: a draft that stayed a draft wasn't filed.
      count: Array.isArray(result?.published) ? result.published.length : 0,
      failed_count: Array.isArray(result?.failed) ? result.failed.length : 0,
    }),
  )
  async publishDrafts(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PublishBackworkDraftsDto,
  ): Promise<PublishBackworkDraftsResponseDto> {
    return this.backworkService.publishDrafts(chapterId, userId, dto.ids);
  }

  // Checking a draft's pages (#5252). A folder saved without opening each
  // document leaves its drafts unchecked: the uploader's browser fetches the
  // stored file to show its pages, then marks the draft checked, swapping in
  // a file flattened again when they added a box.
  @Get('drafts/:id/file')
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({
    summary: "A short-lived link to one of the caller's drafts' file",
  })
  @ApiOkResponse({ type: BackworkDraftFileUrlDto })
  async draftFileUrl(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BackworkDraftFileUrlDto> {
    return {
      url: await this.backworkService.draftFileUrl(id, chapterId, userId),
    };
  }

  @Post('drafts/:id/check')
  @HttpCode(200)
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({
    summary:
      "Mark one of the caller's drafts' pages checked, with its file flattened again when a box was added",
  })
  async checkDraft(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CheckBackworkDraftDto,
  ) {
    return this.backworkService.checkDraft(
      id,
      chapterId,
      userId,
      dto.storage_path !== undefined && dto.file_hash !== undefined
        ? { storage_path: dto.storage_path, file_hash: dto.file_hash }
        : undefined,
    );
  }

  @Delete('drafts/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({ summary: "Delete one of the caller's drafts and its file" })
  async deleteDraft(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.backworkService.deleteDraft(id, chapterId, userId);
    return { success: true };
  }

  // MUST stay above `@Get(':id')`, like `departments` below. A GET, not a
  // POST, so it stays a read: a lapsed chapter can still download its files,
  // one at a time or zipped (`enforceSubscription` lets GETs through).
  @Get('download-urls')
  @ApiOperation({
    summary: 'Signed download links for several resources, for a zip',
  })
  @ApiOkResponse({ type: BackworkDownloadUrlsResponseDto })
  async downloadUrls(
    @CurrentChapterId() chapterId: string,
    @Query() query: BackworkDownloadUrlsQueryDto,
  ): Promise<BackworkDownloadUrlsResponseDto> {
    return {
      files: await this.backworkService.getDownloadUrls(query.ids, chapterId),
    };
  }

  // MUST stay above `@Get(':id')`. Nest matches routes in declaration order and
  // a single-segment `:id` would otherwise swallow this path, resolving it as
  // `getOne('departments')` and answering 404 for a route that exists.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('departments')
  @ApiOperation({ summary: 'List chapter departments' })
  async listDepartments(@CurrentChapterId() chapterId: string) {
    return this.backworkService.getDepartments(chapterId);
  }

  @Patch('departments/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({ summary: 'Update department name' })
  async updateDepartment(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.backworkService.updateDepartment(id, chapterId, dto);
  }

  @Delete('departments/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({
    summary: 'Delete a department (blocked while any resource references it)',
  })
  async deleteDepartment(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.backworkService.deleteDepartment(id, chapterId);
    return { success: true };
  }

  @Post('departments/:id/merge')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({
    summary: 'Merge a department into another, reassigning its resources',
  })
  @ApiCreatedResponse({ type: MergeBackworkTaxonomyResponseDto })
  async mergeDepartments(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeBackworkTaxonomyDto,
  ) {
    return this.backworkService.mergeDepartments(id, dto.target_id, chapterId);
  }

  // MUST stay above `@Get(':id')`, like `departments` above: a single-segment
  // `:id` would otherwise swallow this path as `getOne('courses')`.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('courses')
  @ApiOperation({ summary: 'List chapter course names and nicknames' })
  @ApiOkResponse({ type: [BackworkCourseDto] })
  async listCourses(
    @CurrentChapterId() chapterId: string,
  ): Promise<BackworkCourseDto[]> {
    return this.backworkService.getCourses(chapterId);
  }

  // Open to `backwork:upload` (the class baseline): an uploader may name an
  // unnamed course and add nicknames. Renaming and removing need
  // `backwork:admin`, which the service decides against the stored row
  // (`courseEditRefusal`), so the permission is resolved here rather than by
  // a decorator.
  @Put('courses')
  @ApiOperation({
    summary: 'Name a course or add nicknames (create on first write)',
  })
  @ApiOkResponse({ type: BackworkCourseDto })
  async upsertCourse(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpsertBackworkCourseDto,
  ): Promise<BackworkCourseDto> {
    const isAdmin = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.BACKWORK_ADMIN],
    );
    return this.backworkService.upsertCourse(chapterId, dto, isAdmin);
  }

  @Delete('courses/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({
    summary: "Delete a course's name and nicknames (its files are untouched)",
  })
  async deleteCourse(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.backworkService.deleteCourse(id, chapterId);
    return { success: true };
  }

  // MUST stay above `@Get(':id')`. Nest matches routes in declaration order and
  // a single-segment `:id` would otherwise swallow this path, resolving it as
  // `getOne('professors')` and answering 404 for a route that exists.
  // Enforced by `test/route-declaration-order.e2e-spec.ts` (#990).
  @Get('professors')
  @ApiOperation({ summary: 'List chapter professors' })
  async listProfessors(@CurrentChapterId() chapterId: string) {
    return this.backworkService.getProfessors(chapterId);
  }

  @Patch('professors/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({ summary: 'Update professor name' })
  async updateProfessor(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfessorDto,
  ) {
    return this.backworkService.updateProfessor(id, chapterId, dto);
  }

  @Delete('professors/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({
    summary: 'Delete a professor (blocked while any resource references it)',
  })
  async deleteProfessor(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.backworkService.deleteProfessor(id, chapterId);
    return { success: true };
  }

  @Post('professors/:id/merge')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({
    summary: 'Merge a professor into another, reassigning its resources',
  })
  @ApiCreatedResponse({ type: MergeBackworkTaxonomyResponseDto })
  async mergeProfessors(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeBackworkTaxonomyDto,
  ) {
    return this.backworkService.mergeProfessors(id, dto.target_id, chapterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get resource detail with download URL' })
  @FeatureEvent('backwork-viewed')
  async getOne(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.backworkService.findById(id, chapterId);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({ summary: 'Delete a backwork resource' })
  async delete(
    @CurrentChapterId() chapterId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.backworkService.delete(id, chapterId);
    return { success: true };
  }
}
