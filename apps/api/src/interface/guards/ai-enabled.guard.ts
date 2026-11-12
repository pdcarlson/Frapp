import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { isAiEnabled } from '../../config/ai-config';

/**
 * Every AI route carries this guard, first in its chain, so a server with
 * `AI_ENABLED` off answers as if the route did not exist, before
 * authentication and whatever the caller's role. Clients treat 404
 * `ai.disabled` as "this server has no AI" and hide the entry point.
 *
 * It is the server switch only. The chapter's switch and the member's answer
 * are checked by the gateway's consent seam, per call.
 */
@Injectable()
export class AiEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!isAiEnabled()) {
      throw new NotFoundException({
        code: 'ai.disabled',
        message: 'AI features are not available.',
      });
    }
    return true;
  }
}
