import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          this.log(request, response.statusCode, Date.now() - start);
        },
        error: (err) => {
          this.log(request, err.status || 500, Date.now() - start);
        },
      }),
    );
  }

  private log(request: any, statusCode: number, latencyMs: number): void {
    this.logger.log(
      JSON.stringify({
        requestId: request.requestId,
        userId: request.appUser?.id,
        chapterId: request.chapterId,
        method: request.method,
        path: request.url,
        statusCode,
        latencyMs,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
