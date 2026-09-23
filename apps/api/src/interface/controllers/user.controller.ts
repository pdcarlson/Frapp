import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { LegalAcceptanceService } from '../../application/services/legal-acceptance.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { FreeTier } from '../decorators/subscription.decorator';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import {
  CurrentUser,
  CurrentChapterId,
} from '../decorators/current-user.decorator';
import {
  UpdateUserDto,
  RequestAvatarUploadUrlDto,
  MyPermissionsDto,
  LegalAcceptanceDto,
  AcceptLegalTermsDto,
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
    private readonly legalAcceptance: LegalAcceptanceService,
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

  @Get('me/legal-acceptance')
  @ApiOperation({
    summary: "The caller's Terms of Service and Privacy Policy acceptance",
    description:
      'Whether the caller has accepted the version this server enforces (#2302). Needs no chapter: a user is asked before they join one, and a member is asked again when the version changes.',
  })
  @ApiOkResponse({ type: LegalAcceptanceDto })
  async getMyLegalAcceptance(
    @CurrentUser('id') userId: string,
  ): Promise<LegalAcceptanceDto> {
    return this.legalAcceptance.status(userId);
  }

  @Post('me/legal-acceptance')
  // 200, not 201: it answers with the caller's status, and a repeat creates
  // nothing.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the current Terms of Service and Privacy Policy',
    description:
      "Records the caller's acceptance of the version this server enforces, from the session and the server clock. Idempotent: accepting a version already accepted keeps the first timestamp.",
  })
  @ApiOkResponse({ type: LegalAcceptanceDto })
  async acceptLegalTerms(
    @CurrentUser('id') userId: string,
    @Body() dto: AcceptLegalTermsDto,
  ): Promise<LegalAcceptanceDto> {
    // `@Equals(true)` has already refused anything else. The record is stamped
    // from the session and the server clock, never from the payload.
    return this.legalAcceptance.requireOrAccept(
      userId,
      dto.accept_terms_privacy,
    );
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
      'Individual account deletion per spec/behavior/data-retention.md: profile media is purged first, PII is scrubbed to a "Deleted User" tombstone, historical records stay preserved anonymized, the analytics forget is confirmed, and the Supabase Auth account is deleted last. A 502 means the flow did not finish — depending on the failing step the account may already be anonymized (sign-in still works until the final step succeeds) — and every step is idempotent, so simply retry until it returns success.',
  })
  async deleteMe(@CurrentUser('id') userId: string) {
    await this.accountDeletionService.deleteAccount(userId);
    return { success: true };
  }

  @Post('me/avatar-url')
  @ThrottleFanOutWrite()
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
