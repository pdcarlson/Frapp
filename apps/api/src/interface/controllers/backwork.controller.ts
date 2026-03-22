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
import { BackworkService } from '../../application/services/backwork.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequireAnyOfPermissions,
  RequirePermissions,
} from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  RequestBackworkUploadUrlDto,
  ConfirmBackworkUploadDto,
  UpdateDepartmentDto,
} from '../dtos/backwork.dto';

@ApiTags('Backwork')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequireAnyOfPermissions(
  SystemPermissions.BACKWORK_UPLOAD,
  SystemPermissions.BACKWORK_ADMIN,
)
@Controller('backwork')
export class BackworkController {
  constructor(private readonly backworkService: BackworkService) {}

  @Post('upload-url')
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({ summary: 'Request a signed upload URL' })
  async requestUploadUrl(
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestBackworkUploadUrlDto,
  ) {
    return this.backworkService.requestUploadUrl({
      chapterId,
      filename: dto.filename,
      contentType: dto.content_type,
    });
  }

  @Post()
  @RequirePermissions(SystemPermissions.BACKWORK_UPLOAD)
  @ApiOperation({ summary: 'Confirm upload and store resource metadata' })
  async confirmUpload(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmBackworkUploadDto,
  ) {
    return this.backworkService.confirmUpload({
      chapter_id: chapterId,
      uploader_id: userId,
      ...dto,
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

  @Get('departments')
  @ApiOperation({ summary: 'List chapter departments' })
  async listDepartments(@CurrentChapterId() chapterId: string) {
    return this.backworkService.getDepartments(chapterId);
  }

  @Patch('departments/:id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({ summary: 'Update department name' })
  async updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.backworkService.updateDepartment(id, dto);
  }

  @Get('professors')
  @ApiOperation({ summary: 'List chapter professors' })
  async listProfessors(@CurrentChapterId() chapterId: string) {
    return this.backworkService.getProfessors(chapterId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get resource detail with download URL' })
  async getOne(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    return this.backworkService.findById(id, chapterId);
  }

  @Delete(':id')
  @RequirePermissions(SystemPermissions.BACKWORK_ADMIN)
  @ApiOperation({ summary: 'Delete a backwork resource' })
  async delete(@CurrentChapterId() chapterId: string, @Param('id') id: string) {
    await this.backworkService.delete(id, chapterId);
    return { success: true };
  }
}
