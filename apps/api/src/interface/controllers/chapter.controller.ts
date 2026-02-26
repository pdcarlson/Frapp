import { Body, Controller, Get, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { ChapterService } from '../../application/services/chapter.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { CurrentUser, CurrentChapterId } from '../decorators/current-user.decorator';
import { CreateChapterDto, UpdateChapterDto } from '../dtos/chapter.dto';

@ApiTags('Chapters')
@ApiBearerAuth()
@Controller('chapters')
export class ChapterController {
  constructor(private readonly chapterService: ChapterService) {}

  @Post()
  @UseGuards(SupabaseAuthGuard)
  @UseInterceptors(AuthSyncInterceptor)
  @ApiOperation({ summary: 'Create a new chapter' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.chapterService.create(userId, dto);
  }

  @Get('current')
  @UseGuards(SupabaseAuthGuard, ChapterGuard)
  @ApiOperation({ summary: 'Get current chapter' })
  async getCurrent(@CurrentChapterId() chapterId: string) {
    return this.chapterService.findById(chapterId);
  }

  @Patch('current')
  @UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Update current chapter settings' })
  async update(
    @CurrentChapterId() chapterId: string,
    @Body() dto: UpdateChapterDto,
  ) {
    return this.chapterService.update(chapterId, dto);
  }
}
