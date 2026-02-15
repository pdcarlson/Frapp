import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { ChatService } from '../../application/services/chat.service';
import { UserService } from '../../application/services/user.service';
import { ChatGateway } from '../gateways/chat.gateway';
import { CreateChatChannelDto, SendChatMessageDto } from '../dtos/chat.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import type { RequestWithUser } from '../auth.types';

@ApiTags('chat')
@Controller('chat')
@UseGuards(ClerkAuthGuard, ChapterGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Post('channels')
  @ApiOperation({
    summary: 'Create a new chat channel (Admin Only - TODO: RBAC)',
  })
  async createChannel(
    @Req() req: RequestWithUser,
    @Body() dto: CreateChatChannelDto,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.chatService.createChannel({
      ...dto,
      chapterId,
      description: dto.description || null,
    });
  }

  @Get('channels')
  @ApiOperation({ summary: 'List all accessible channels for the chapter' })
  async getChannels(@Req() req: RequestWithUser) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.chatService.getChannels(chapterId);
  }

  @Get('channels/:id/messages')
  @ApiOperation({ summary: 'Get message history for a channel' })
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.chatService.getMessages(
      id,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  @Post('channels/:id/messages')
  @ApiOperation({ summary: 'Send a message to a channel via REST' })
  async sendMessage(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    const user = await this.userService.findByClerkId(req.user.sub);

    const message = await this.chatService.sendMessage(
      user.id,
      chapterId,
      id,
      dto.content,
      dto.metadata,
    );

    // Broadcast via WebSocket
    this.chatGateway.broadcastMessage(id, message);

    return message;
  }
}
