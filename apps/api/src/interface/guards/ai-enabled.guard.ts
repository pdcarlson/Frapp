import { Injectable, type CanActivate } from '@nestjs/common';
import { isAiEnabled } from '#domain/utils/ai-runs';
import { aiNotAvailable } from '../../application/services/ai-run.service';

/**
 * The server switch for an AI controller (ADR-28): the one switch the job
 * queue reads too (`isAiEnabled`). Off, every route behind it answers 404
 * `ai.not_available` before auth runs, so a server with AI off behaves as
 * one that never had it.
 *
 * Put it first: `@UseGuards(AiEnabledGuard, SupabaseAuthGuard, ...)`.
 */
@Injectable()
export class AiEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (isAiEnabled()) return true;
    throw aiNotAvailable();
  }
}
