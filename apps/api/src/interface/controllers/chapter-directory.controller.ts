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
    description: 'Search query (org name, letters, designation)',
  })
  @ApiQuery({
    name: 'university',
    required: false,
    description: 'Filter by university short name',
  })
  async search(
    @Query('q') q?: string,
    @Query('university') university?: string,
  ) {
    return this.directoryService.search(q ?? '', university);
  }
}
