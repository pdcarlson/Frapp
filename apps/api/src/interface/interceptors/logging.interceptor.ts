import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import type { RequestContext } from '../types/request-context.types';

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
          this.log(request, response.statusCode, Date.now() - start);
        },
        error: (err: { status?: number }) => {
          this.log(request, err.status ?? 500, Date.now() - start);
        },
      }),
    );
  }

  private log(
    request: RequestContext & Request,
    statusCode: number | undefined,
    latencyMs: number,
  ): void {
    this.logger.log(
      JSON.stringify({
        requestId: request.requestId,
        userId: request.appUser?.id,
        chapterId: request.chapterId,
        method: request.method,
        path: request.url,
        statusCode: statusCode ?? 500,
        latencyMs,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
