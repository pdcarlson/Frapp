import { Body, Controller, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatChannelOrderService } from '../../application/services/chat-channel-order.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { CurrentChapterId } from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  ReorderCategoriesDto,
  ReorderChannelsDto,
  ReorderResponseDto,
} from '../dtos/chat-order.dto';

/**
 * The chapter's channel and category order (owner, 2026-11-11), written by an
 * officer dragging rows in the web rail. Under the `channels` prefix beside
 * `ChatController`, in a class of its own so that controller's busy file
 * doesn't grow. No route here can be shadowed by `ChatController`: it declares
 * no single-segment `PUT :id` and no `PUT :id/order`. Guard chain as
 * `ChatController`, `channels:manage` on both routes.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.CHANNELS_MANAGE)
@FreeTier()
@Controller('channels')
export class ChatOrderController {
  constructor(private readonly order: ChatChannelOrderService) {}

  @Put('order')
  @ApiOperation({
    summary: "Set one section's channel order, moving channels into it",
  })
  @ApiOkResponse({ type: ReorderResponseDto })
  async reorderChannels(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ReorderChannelsDto,
  ): Promise<ReorderResponseDto> {
    await this.order.reorderChannels(
      chapterId,
      dto.category_id ?? null,
      dto.channel_ids,
    );
    return { success: true };
  }

  @Put('categories/order')
  @ApiOperation({ summary: "Set the chapter's category order" })
  @ApiOkResponse({ type: ReorderResponseDto })
  async reorderCategories(
    @CurrentChapterId() chapterId: string,
    @Body() dto: ReorderCategoriesDto,
  ): Promise<ReorderResponseDto> {
    await this.order.reorderCategories(chapterId, dto.category_ids);
    return { success: true };
  }
}
