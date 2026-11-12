import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { isAiEnabled } from '#domain/utils/ai-enabled';

/**
 * Every AI route carries this guard, first in its chain, so a server with
 * `AI_ENABLED` off answers as if the route did not exist, before
 * authentication and whatever the caller's role. Clients treat 404
 * `ai.not_available` as "this server has no AI" and hide the entry point.
 *
 * It is the server switch only. The chapter's switch and the member's answer
 * are checked by the gateway's consent seam, per call.
 */
@Injectable()
export class AiEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!isAiEnabled()) {
      throw new NotFoundException({
        // The same code `AiRunService` answers with (`aiNotAvailable`): one
        // code for "AI is off here", whichever layer says it.
        code: 'ai.not_available',
        message: 'AI features are not available.',
      });
    }
    return true;
  }
}
