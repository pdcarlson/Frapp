import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GifService } from '../../application/services/gif.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { CurrentUser } from '../decorators/current-user.decorator';
import {
  AddGifFavoriteDto,
  GifAvailabilityDto,
  GifPageDto,
  GifPageQueryDto,
  GifSearchQueryDto,
} from '../dtos/gif.dto';

/**
 * GIF search for chat's GIF picker (#4631). The provider's key never leaves
 * the server: clients search here, and the provider sees only Frapp's server,
 * never which member searched. Same guard chain as `ChatController`,
 * since only someone who can read chat has a use for it.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('gifs')
export class GifController {
  constructor(private readonly gifs: GifService) {}

  @Get('availability')
  @ApiOperation({ summary: 'Whether GIF search is set up, and its provider' })
  @ApiOkResponse({ type: GifAvailabilityDto })
  availability(): GifAvailabilityDto {
    return this.gifs.availability();
  }

  @Get('trending')
  @ApiOperation({ summary: 'Trending GIFs, for the picker before a search' })
  @ApiOkResponse({ type: GifPageDto })
  trending(@Query() query: GifPageQueryDto): Promise<GifPageDto> {
    return this.gifs.trending(query.page ?? 1);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search GIFs (rated PG-13 at most)' })
  @ApiOkResponse({ type: GifPageDto })
  search(@Query() query: GifSearchQueryDto): Promise<GifPageDto> {
    return this.gifs.search(query.q, query.page ?? 1);
  }

  @Get('favorites')
  @ApiOperation({
    summary: "The member's favorite GIFs, newest first (#5772)",
  })
  @ApiOkResponse({ type: GifPageDto })
  favorites(@CurrentUser('id') userId: string): Promise<GifPageDto> {
    return this.gifs.listFavorites(userId);
  }

  @Post('favorites')
  @HttpCode(204)
  @ApiOperation({ summary: 'Star a GIF from the picker (#5772)' })
  @ApiNoContentResponse()
  addFavorite(
    @CurrentUser('id') userId: string,
    @Body() dto: AddGifFavoriteDto,
  ): Promise<void> {
    return this.gifs.addFavorite(userId, dto);
  }

  @Delete('favorites/:gifId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unstar a GIF (#5772)' })
  @ApiNoContentResponse()
  removeFavorite(
    @CurrentUser('id') userId: string,
    @Param('gifId') gifId: string,
  ): Promise<void> {
    return this.gifs.removeFavorite(userId, gifId);
  }
}
