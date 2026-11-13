import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ChatFormService } from '../../application/services/chat-form.service';
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
import {
  FormResponseDto,
  FormResponsesDto,
  OwnFormResponseDto,
  SaveFormResponseDto,
} from '../dtos/chat-form.dto';

/**
 * A member's own answers to a form card in chat (#3926 step 3). Guarded as
 * `ChatController` is: the card is a chat message, so anyone who can read its
 * channel can answer it, and the service checks that per card.
 */
@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('channels')
export class ChatFormController {
  constructor(private readonly forms: ChatFormService) {}

  @Get('messages/:messageId/form-response')
  @ApiOperation({
    summary:
      "The caller's own answers to a form card, or null before they answer",
  })
  @ApiOkResponse({ type: OwnFormResponseDto })
  async getOwnResponse(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<OwnFormResponseDto> {
    return {
      response: await this.forms.getOwnResponse(messageId, chapterId, userId),
    };
  }

  @Get('messages/:messageId/form-responses')
  @ApiOperation({
    summary:
      'Everyone’s answers to a form card, and who hasn’t answered, for the member who posted it',
    description:
      'Only the form’s sender, who must still be able to read its channel: 403 for anyone else, `channels:manage` holders included. 400 when the message is not a form, 404 when it is deleted. Readable after the form closes.',
  })
  @ApiOkResponse({ type: FormResponsesDto })
  async getResponses(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
  ): Promise<FormResponsesDto> {
    return this.forms.getResponses(messageId, chapterId, userId);
  }

  @Put('messages/:messageId/form-response')
  @ApiOperation({
    summary:
      "Save the caller's answers to a form card, replacing their last ones (until the form closes)",
  })
  @ApiOkResponse({ type: FormResponseDto })
  async saveResponse(
    @Param('messageId') messageId: string,
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @Body() body: SaveFormResponseDto,
  ): Promise<FormResponseDto> {
    return this.forms.saveResponse(messageId, chapterId, userId, body.answers);
  }
}
