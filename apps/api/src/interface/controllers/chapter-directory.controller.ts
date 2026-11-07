import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ChapterDirectoryService } from '../../application/services/chapter-directory.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

@ApiTags('Chapter Directory')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('chapter-directory')
export class ChapterDirectoryController {
  constructor(private readonly directoryService: ChapterDirectoryService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search the chapter directory (autocomplete for onboarding)',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description:
      'Search query. Every word must start a word of the organization (name, letters or nickname), chapter, or school (name, short name or nickname); a longer word may be a close misspelling. With no query and no university, finds nothing.',
  })
  @ApiQuery({
    name: 'university',
    required: false,
    description:
      'Narrow to chapters where a word of the school name, short name or a nickname starts with this ("rens", "RPI"). Without q, lists that school\'s chapters.',
  })
  async search(
    @Query('q') q?: string,
    @Query('university') university?: string,
  ) {
    return this.directoryService.search(q ?? '', university);
  }
}
