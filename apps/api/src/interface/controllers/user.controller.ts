import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { UserService } from '../../application/services/user.service';
import { AccountDeletionService } from '../../application/services/account-deletion.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import {
  UpdateUserDto,
  RequestAvatarUploadUrlDto,
  MyPermissionsDto,
} from '../dtos/user.dto';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@UseInterceptors(AuthSyncInterceptor)
@FreeTier()
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly rbacService: RbacService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.userService.findById(userId);
  }

  @Get('me/permissions')
  @UseGuards(ChapterGuard)
  @ApiOperation({
    summary: 'Get effective permissions for the active chapter',
    description:
      "Returns the caller's flattened permission set for the chapter identified by the `x-chapter-id` header. Clients use this to render permission-aware UI without duplicating RBAC rules or issuing one request per role.",
  })
  @ApiOkResponse({ type: MyPermissionsDto })
  async getMyPermissions(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
  ): Promise<MyPermissionsDto> {
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      userId,
    );
    return { permissions };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateMe(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(userId, dto);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Delete current account (irreversible)',
    description:
      'Individual account deletion per spec/behavior/data-retention.md: PII is scrubbed to a "Deleted User" tombstone, historical records stay preserved anonymized, profile media is removed, and the Supabase Auth account is deleted last. If auth deletion fails the response is 502 and the request can simply be retried — every prior step is idempotent.',
  })
  async deleteMe(@CurrentUser('id') userId: string) {
    await this.accountDeletionService.deleteAccount(userId);
    return { success: true };
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
