import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { NotificationService } from '../../application/services/notification.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  RegisterPushTokenDto,
  ListNotificationPreferencesQueryDto,
  ListNotificationsQueryDto,
  ClearNotificationsDto,
  ClearNotificationsResultDto,
  MarkNotificationsReadDto,
  MarkNotificationsReadResultDto,
  UpdateNotificationPreferenceDto,
  UpdateUserSettingsDto,
  UserSettingsDto,
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
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @FreeTier()
  @ApiOperation({ summary: 'List in-app notifications for current user' })
  async listNotifications(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationService.listNotifications(userId, chapterId, {
      limit: query.limit,
    });
  }

  @Post('notifications/read')
  @HttpCode(200)
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @FreeTier()
  @ApiOperation({
    summary:
      'Mark all unread notifications read, or only those pointing at the named screens, or only the named ids',
  })
  @ApiOkResponse({ type: MarkNotificationsReadResultDto })
  async markAllRead(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: MarkNotificationsReadDto,
  ): Promise<MarkNotificationsReadResultDto> {
    return this.notificationService.markNotificationsRead(userId, chapterId, {
      screens: dto.screens,
      ids: dto.ids,
    });
  }

  @Post('notifications/clear')
  @HttpCode(200)
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @FreeTier()
  @ApiOperation({
    summary: "Clear (delete) the caller's own notifications by id",
  })
  @ApiOkResponse({ type: ClearNotificationsResultDto })
  async clearNotifications(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: ClearNotificationsDto,
  ): Promise<ClearNotificationsResultDto> {
    return this.notificationService.clearNotifications(
      userId,
      chapterId,
      dto.ids,
    );
  }

  @Patch('notifications/:id/read')
  @UseGuards(ChapterGuard, PermissionsGuard)
  @RequirePermissions(SystemPermissions.MEMBERS_VIEW)
  @FreeTier()
  @ApiOperation({ summary: 'Mark notification as read' })
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @CurrentChapterId() chapterId: string,
  ) {
    return this.notificationService.markNotificationRead(id, userId, chapterId);
  }

  @Get('notifications/preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  async getPreferences(
    @CurrentUser('id') userId: string,
    @Query() query: ListNotificationPreferencesQueryDto,
  ) {
    return this.notificationService.getPreferences(userId, query.chapterId);
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
  @ApiOkResponse({ type: UserSettingsDto })
  async getSettings(
    @CurrentUser('id') userId: string,
  ): Promise<UserSettingsDto> {
    return this.notificationService.getSettings(userId);
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Update user settings (quiet hours, theme, status)',
  })
  @ApiOkResponse({ type: UserSettingsDto })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserSettingsDto,
  ): Promise<UserSettingsDto> {
    return this.notificationService.updateSettings(userId, dto);
  }
}
