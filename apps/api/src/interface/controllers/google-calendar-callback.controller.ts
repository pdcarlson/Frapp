import { Controller, Get, Query, Redirect } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { GoogleCalendarService } from '../../application/services/google-calendar/google-calendar.service';

/**
 * Google's redirect after a member's Google sign-in (#3322, step 2).
 *
 * No auth guard, and it cannot have one: Google sends the member's browser
 * here as a top-level navigation, with no bearer token or chapter. It
 * connects nothing. It reads the single-use sign-in named by `state` only to
 * learn where that sign-in started, and sends the browser back there with
 * Google's code, where the member's own signed-in client finishes it
 * (`POST /v1/google-calendar/confirm`). Excluded from the OpenAPI document:
 * no Frapp client calls it.
 */
@Controller('google-calendar')
export class GoogleCalendarCallbackController {
  constructor(private readonly google: GoogleCalendarService) {}

  @Get('callback')
  @Redirect()
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const url = await this.google.callback({ code, state, error });
    // 302, never cached: a cached OAuth redirect would replay one outcome.
    return { url, statusCode: 302 };
  }
}
