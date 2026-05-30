import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from '../../application/services/analytics.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { CurrentUser } from '../decorators/current-user.decorator';
import { TrackEventDto } from '../dtos/analytics.dto';

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
  getIdentity(@CurrentUser('id') userId: string) {
    // `enabled: false` tells the client SDK to stay dark (no key configured).
    const distinctId = this.analytics.getDistinctId(userId);
    return { distinct_id: distinctId, enabled: distinctId !== null };
  }

  @Post('events')
  @ApiOperation({
    summary:
      'Record a behavioral event. The server keys it pseudonymously and enforces the per-chapter opt-out.',
  })
  async track(@CurrentUser('id') userId: string, @Body() dto: TrackEventDto) {
    try {
      await this.analytics.track(dto.name, userId, {
        chapterId: dto.chapter_id,
        properties: dto.properties,
      });
    } catch (error) {
      // assertContentFreeProperties throws on a content/PII payload — surface
      // that to the caller as a 400 so the bad event is fixed, not swallowed.
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid analytics event',
      );
    }
    return { success: true };
  }
}
