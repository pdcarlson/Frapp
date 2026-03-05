import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { RequestContext } from '../types/request-context.types';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{
      status: (code: number) => { json: (body: unknown) => void };
    }>();
    const request = ctx.getRequest<RequestContext>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    const requestId = request.requestId ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          requestId,
          userId: request.appUser?.id,
          chapterId: request.chapterId,
          method: request.method,
          path: request.url,
          statusCode: status,
          error:
            exception instanceof Error ? exception.stack : String(exception),
        }),
      );
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] || 'Error',
      message,
      requestId,
    });
  }
}
