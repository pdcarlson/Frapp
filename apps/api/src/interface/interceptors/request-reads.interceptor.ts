import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { sealRequestReadsForWrites } from '../../infrastructure/supabase/request-reads';

/**
 * Seals a write request's read store once its guards have passed
 * (`request-reads.ts`, #3728). The guards of a `POST` share the membership and
 * role reads they started during the session check; its handler reads afresh,
 * so it can never be handed a row as it was before its own write.
 *
 * Interceptors run after every guard and before the handler, which is exactly
 * the line to draw. Registered globally in `configureApp`, so no route can be
 * left out.
 */
@Injectable()
export class RequestReadsInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    sealRequestReadsForWrites();
    return next.handle();
  }
}
