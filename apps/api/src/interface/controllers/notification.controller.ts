import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationService } from '../../application/services/notification.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { CurrentUser } from '../decorators/current-user.decorator';
import {
  RegisterPushTokenDto,
  UpdateNotificationPreferenceDto,
  UpdateUserSettingsDto,
} from '../dtos/notification.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@UseInterceptors(AuthSyncInterceptor)
@Controller()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('push-tokens')
  @ApiOperation({ summary: 'Register push token' })
  async registerPushToken(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.notificationService.registerPushToken(
      userId,
      dto.token,
      dto.device_name,
    );
  }

  @Delete('push-tokens/:id')
  @ApiOperation({ summary: 'Remove push token' })
  async removePushToken(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    await this.notificationService.removePushToken(id, userId);
    return { success: true };
  }

  @Get('notifications')
  @ApiOperation({ summary: 'List in-app notifications for current user' })
  async listNotifications(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    const options = limit ? { limit: parseInt(limit, 10) } : undefined;
    return this.notificationService.listNotifications(userId, options);
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.notificationService.markNotificationRead(id, userId);
  }

  @Get('notifications/preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  async getPreferences(
    @CurrentUser('id') userId: string,
    @Query('chapterId') chapterId: string,
  ) {
    if (!chapterId) {
      throw new BadRequestException('chapterId query parameter is required');
    }
    return this.notificationService.getPreferences(userId, chapterId);
  }

  @Patch('notifications/preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  async updatePreference(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notificationService.updatePreference(
      userId,
      dto.chapter_id,
      dto.category,
      dto.is_enabled,
    );
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get user settings' })
  async getSettings(@CurrentUser('id') userId: string) {
    return this.notificationService.getSettings(userId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update user settings (quiet hours, theme)' })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return this.notificationService.updateSettings(userId, dto);
  }
}
