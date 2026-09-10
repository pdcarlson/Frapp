import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { RequestContext } from '../types/request-context.types';
import { emitSanitizedHttpRequestLog } from '../utils/http-request-log';

export { forwardedShape } from '../utils/http-request-log';
export type { ForwardedShape } from '../utils/http-request-log';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<{
            statusCode?: number;
          }>();
          emitSanitizedHttpRequestLog(
            this.logger,
            request,
            response.statusCode,
            Date.now() - start,
          );
        },
        error: (err: { status?: number }) => {
          emitSanitizedHttpRequestLog(
            this.logger,
            request,
            err.status ?? 500,
            Date.now() - start,
          );
        },
      }),
    );
  }
}
