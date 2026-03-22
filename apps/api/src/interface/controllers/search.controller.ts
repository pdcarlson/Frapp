import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SearchService } from '../../application/services/search.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';

@ApiTags('Search')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Cross-domain search (backwork, events, members, messages)',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query' })
  async search(
    @CurrentChapterId() chapterId: string,
    @Query('q') query: string,
  ) {
    return this.searchService.search(chapterId, query ?? '');
  }
}
