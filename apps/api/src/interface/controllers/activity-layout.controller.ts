import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SystemPermissions } from '#domain/constants/permissions';
import { ActivityLayoutService } from '../../application/services/activity-layout.service';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import {
  ActivityLayoutDto,
  UpdateActivityLayoutDto,
} from '../dtos/activity-layout.dto';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';

/**
 * How a member ordered and hid their Activity cards (#5520,
 * `spec/behavior/activity.md` § Cards), synced between phone and web.
 * Activity's own gate (`members:view`) is its gate, as on
 * `ActivityCardController`; no further permission, since every route acts on
 * the caller's own arrangement only.
 */
@ApiTags('Activity')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('activity/layout')
export class ActivityLayoutController {
  constructor(private readonly layouts: ActivityLayoutService) {}

  @Get()
  @ApiOperation({
    summary: "The caller's own order of their Activity cards",
    description:
      'Which cards the caller shows, in order, and which they hid, in this chapter. When they have never saved one, both lists are empty and `saved` is false: show the default for their role.',
  })
  @ApiOkResponse({ type: ActivityLayoutDto })
  async get(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ActivityLayoutDto> {
    return this.layouts.get(chapterId, userId);
  }

  @Put()
  @ApiOperation({
    summary: "Save the order of the caller's Activity cards",
    description:
      'Replaces the whole arrangement: send both lists every time. A card may be named only once, in one list or the other. Any well-formed key is kept, including one this server does not know. Follows the caller to their other devices.',
  })
  @ApiOkResponse({ type: ActivityLayoutDto })
  async save(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateActivityLayoutDto,
  ): Promise<ActivityLayoutDto> {
    return this.layouts.save(chapterId, userId, {
      card_order: dto.card_order,
      hidden_cards: dto.hidden_cards,
    });
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: "Put the caller's Activity cards back to the default",
    description:
      "Forgets the caller's saved order, so Activity shows the default for their role again. Answers 204 whether or not anything was saved.",
  })
  @ApiNoContentResponse()
  async reset(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.layouts.reset(chapterId, userId);
  }
}
