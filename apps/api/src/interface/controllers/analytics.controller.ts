import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ContentFreePropertyError } from '@repo/validation';
import { AnalyticsService } from '../../application/services/analytics.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { CurrentUser } from '../decorators/current-user.decorator';
import {
  IdentityResponseDto,
  TrackEventDto,
  TrackEventResponseDto,
} from '../dtos/analytics.dto';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@UseInterceptors(AuthSyncInterceptor)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('identity')
  @ApiOperation({
    summary:
      "Get the caller's pseudonymous analytics id (HMAC of user id). Lets the client attribute events without ever holding the salt.",
  })
  @ApiOkResponse({ type: IdentityResponseDto })
  getIdentity(@CurrentUser('id') userId: string): IdentityResponseDto {
    // `enabled: false` tells the client SDK to stay dark (no key configured).
    const distinctId = this.analytics.getDistinctId(userId);
    return { distinct_id: distinctId, enabled: distinctId !== null };
  }

  @Post('events')
  @ApiOperation({
    summary:
      'Record a behavioral event. The server keys it pseudonymously and enforces the per-chapter opt-out.',
  })
  @ApiCreatedResponse({ type: TrackEventResponseDto })
  async track(
    @CurrentUser('id') userId: string,
    @Body() dto: TrackEventDto,
  ): Promise<TrackEventResponseDto> {
    try {
      await this.analytics.track(dto.name, userId, {
        chapterId: dto.chapter_id,
        properties: dto.properties,
      });
    } catch (error) {
      // Only a content/PII payload is a caller error → 400. Anything else is an
      // unexpected server fault; rethrow so Nest maps it to 500 rather than
      // masking it as a client mistake.
      if (error instanceof ContentFreePropertyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    return { success: true };
  }
}
