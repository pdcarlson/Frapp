import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserService } from '../../application/services/user.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { AuthSyncGuard } from '../guards/auth-sync.guard';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import { UpdateUserDto, RequestAvatarUploadUrlDto } from '../dtos/user.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, AuthSyncGuard)
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
  @UseGuards(ChapterGuard)
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
