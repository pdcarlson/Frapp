import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from '../../application/services/notification.service';
import { UserService } from '../../application/services/user.service';
import { RegisterPushTokenDto } from '../dtos/notification.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import type { RequestWithUser } from '../auth.types';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
  ) {}

  @Post('tokens')
  @ApiOperation({ summary: 'Register a push notification token' })
  async registerToken(
    @Req() req: RequestWithUser,
    @Body() dto: RegisterPushTokenDto,
  ) {
    const user = await this.userService.findByClerkId(req.user.sub);
    await this.notificationService.registerToken(
      user.id,
      dto.token,
      dto.deviceName,
    );
    return { success: true };
  }

  @Get()
  @ApiOperation({ summary: 'Get notification history for current user' })
  async getHistory(@Req() req: RequestWithUser) {
    const user = await this.userService.findByClerkId(req.user.sub);
    return this.notificationService.getHistory(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markRead(@Param('id') id: string) {
    await this.notificationService.markRead(id);
    return { success: true };
  }
}
