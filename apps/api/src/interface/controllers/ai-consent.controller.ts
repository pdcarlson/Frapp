import {
  Body,
  Controller,
  Get,
  Patch,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AiConsentService } from '../../application/services/ai/ai-consent.service';
import { AiEnabledGuard } from '../guards/ai-enabled.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { FreeTier } from '../decorators/subscription.decorator';
import {
  CurrentChapterId,
  CurrentMember,
  CurrentUser,
} from '../decorators/current-user.decorator';
import type { MemberContext } from '../types/request-context.types';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  AiChapterSettingsDto,
  AiConsentStateDto,
  AnswerAiConsentDto,
  UpdateAiChapterSettingsDto,
} from '../dtos/ai-consent.dto';

const AI_OFF = {
  description: 'AI is off on this server (`ai.not_available`).',
};

/**
 * The member's answer on the AI sheet (#4308, `spec/behavior/ai.md` §
 * Consent).
 *
 * The answer belongs to the person, not to a chapter (one answer covers every
 * chapter they are in), so these routes need a signed-in user and nothing
 * more: someone who has left every chapter can still read the sheet and say
 * No, which stops their old messages being read wherever chat is a source.
 * `AiEnabledGuard` comes first, so a server with `AI_ENABLED` off answers 404
 * `ai.not_available` on every route, as if none existed. Free tier: answering
 * the sheet, No above all, is never paid functionality.
 *
 * With no `ChapterGuard`, nothing else resolves the caller's Frapp user id
 * from their Supabase session: `AuthSyncInterceptor` does, as on the other
 * chapter-less routes (`/v1/users/me`, invites). Without it `@CurrentUser('id')`
 * was undefined and every read answered 500 (found walking the sheet, #4308).
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard)
@UseInterceptors(AuthSyncInterceptor)
@FreeTier()
@Controller('ai')
export class AiConsentController {
  constructor(private readonly consent: AiConsentService) {}

  @Get('consent')
  @ApiOperation({
    summary: 'Get the AI sheet and the caller’s answer',
    description:
      'The current sheet (every provider and every kind of data sent) and the caller’s answer on it. `answer: null` means not answered, which counts as No: show the sheet.',
  })
  @ApiOkResponse({ type: AiConsentStateDto })
  @ApiNotFoundResponse(AI_OFF)
  getConsent(@CurrentUser('id') userId: string): Promise<AiConsentStateDto> {
    return this.consent.getConsentState(userId);
  }

  @Put('consent')
  @ApiOperation({
    summary: 'Answer the AI sheet',
    description:
      'Records Yes or No on the sheet version the caller was shown, from the sheet or later from Settings. One answer covers every chapter the caller is in, and needs no chapter: someone who has left every chapter can still say No.',
  })
  @ApiOkResponse({ type: AiConsentStateDto })
  @ApiConflictResponse({
    description:
      'The sheet changed since it was shown (`ai.consent.stale_sheet`): read it again.',
  })
  @ApiNotFoundResponse(AI_OFF)
  answerConsent(
    @CurrentUser('id') userId: string,
    @Body() dto: AnswerAiConsentDto,
  ): Promise<AiConsentStateDto> {
    return this.consent.answer(userId, dto.sheet_version, dto.answer === 'yes');
  }
}

/**
 * The president's switch for each AI feature family (#4308). Read by any
 * member (`MEMBERS_VIEW`, the baseline every member holds); changed only by
 * the President, which the service checks. `AiEnabledGuard` comes first, as
 * above.
 */
@ApiTags('AI')
@ApiBearerAuth()
@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@FreeTier()
@Controller('ai')
export class AiChapterSettingsController {
  constructor(private readonly consent: AiConsentService) {}

  @Get('settings')
  @ApiOperation({
    summary: 'Get the chapter’s AI switches',
    description:
      'Which AI features the president has turned on: Ask, meeting notes, and chat as a source. All off until then. `can_change` says whether the caller is the president, who alone may change them.',
  })
  @ApiOkResponse({ type: AiChapterSettingsDto })
  @ApiNotFoundResponse(AI_OFF)
  getSettings(
    @CurrentChapterId() chapterId: string,
    @CurrentMember() member: MemberContext,
  ): Promise<AiChapterSettingsDto> {
    return this.consent.getChapterSettings(chapterId, member.role_ids);
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Turn the chapter’s AI features on or off',
    description:
      'President only. Each change is recorded in the audit log and mirrored to #chapter-audit; a switch turned off stops that feature’s next call.',
  })
  @ApiOkResponse({ type: AiChapterSettingsDto })
  @ApiForbiddenResponse({
    description:
      'The caller is not the chapter’s president (`ai.settings.president_only`).',
  })
  @ApiNotFoundResponse(AI_OFF)
  updateSettings(
    @CurrentChapterId() chapterId: string,
    @CurrentUser('id') userId: string,
    @CurrentMember() member: MemberContext,
    @Body() dto: UpdateAiChapterSettingsDto,
  ): Promise<AiChapterSettingsDto> {
    return this.consent.updateChapterSettings(
      chapterId,
      { userId, roleIds: member.role_ids },
      dto,
    );
  }
}
