import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  Logger,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { CreateInviteDto, AcceptInviteDto } from '../dtos/invite.dto';
import { InviteService } from '../../application/services/invite.service';
import type { RequestWithUser } from '../auth.types';

@ApiTags('invites')
@ApiBearerAuth()
@Controller()
export class InviteController {
  private readonly logger = new Logger(InviteController.name);

  constructor(private readonly inviteService: InviteService) {}

  @Post('chapters/:id/invites')
  @UseGuards(ClerkAuthGuard, ChapterGuard)
  @ApiHeader({ name: 'x-chapter-id', description: 'Chapter UUID' })
  @ApiOperation({ summary: 'Create a new member invite for a chapter' })
  @ApiResponse({ status: 201, description: 'Invite created' })
  async create(
    @Param('id') chapterId: string,
    @Body() dto: CreateInviteDto,
    @Request() req: RequestWithUser,
  ) {
    this.logger.log(
      `User ${req.user.sub} creating invite for chapter ${chapterId}`,
    );
    return this.inviteService.createInvite({
      chapterId,
      role: dto.role,
      createdBy: req.user.sub,
    });
  }

  @Post('onboarding/join')
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({ summary: 'Accept an invite token to join a chapter' })
  @ApiResponse({ status: 200, description: 'Invite accepted' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async accept(@Body() dto: AcceptInviteDto, @Request() req: RequestWithUser) {
    this.logger.log(
      `User ${req.user.sub} accepting invite with token ${dto.token}`,
    );
    return this.inviteService.acceptInvite(dto.token, req.user.sub);
  }
}
