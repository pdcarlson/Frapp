import {
  Injectable,
  NotFoundException,
  type CanActivate,
} from '@nestjs/common';

/**
 * The server switch for every AI route (ADR-28; slice A1 owns the switch).
 * On is exactly `AI_ENABLED=true`; anything else, unset included, is off, and
 * every AI route answers 404 `ai.disabled` before auth runs, so a server with
 * AI off behaves as one that never had it.
 *
 * Put it first: `@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ...)`.
 */
@Injectable()
export class AiEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.AI_ENABLED === 'true') return true;
    throw new NotFoundException({
      code: 'ai.disabled',
      message: 'AI features are not available.',
    });
  }
}
