import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatThreadService } from '../../application/services/chat-thread.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { MemberThreadDto } from '../dtos/chat.dto';

/**
 * All threads (#4960): the caller's threads across every channel they may
 * read. Its own path rather than under `channels/`, where a literal segment
 * would sit beside `channels/:id` routes. Same guard chain and permission as
 * `ChatThreadController`; the service authorizes each channel.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('threads')
export class MemberThreadController {
  constructor(private readonly threads: ChatThreadService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every thread the caller follows or muted, across channels, newest activity first, with new-reply counts',
  })
  @ApiOkResponse({ type: MemberThreadDto, isArray: true })
  list(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.threads.getMemberThreads(chapterId, userId);
  }
}
