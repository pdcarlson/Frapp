import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiHeader,
} from '@nestjs/swagger';
import { UserService } from '../../application/services/user.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { AuthSyncGuard } from '../guards/auth-sync.guard';
import { SystemPermissions } from '../../domain/constants/permissions';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import { UpdateUserDto, RequestAvatarUploadUrlDto } from '../dtos/user.dto';

@ApiTags('Users')
@ApiBearerAuth()
@ApiSecurity('chapter-id')
@ApiHeader({
  name: 'x-chapter-id',
  required: true,
  description: 'Active chapter context (required by ChapterGuard)',
})
@UseGuards(SupabaseAuthGuard, AuthSyncGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.userService.findById(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(userId, dto);
  }

  @Post('me/avatar-url')
  @ApiOperation({ summary: 'Get signed upload URL for profile photo' })
  async requestAvatarUploadUrl(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Body() dto: RequestAvatarUploadUrlDto,
  ) {
    return this.userService.requestAvatarUploadUrl(
      chapterId,
      userId,
      dto.filename,
      dto.content_type,
    );
  }
}
