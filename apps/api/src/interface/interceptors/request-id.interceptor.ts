import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { getHeaderValue, RequestContext } from '../types/request-context.types';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const response = context.switchToHttp().getResponse<Response>();

    const requestId = getHeaderValue(request.headers, 'x-request-id');
    const resolvedRequestId = requestId ?? `req_${uuidv4()}`;
    request.requestId = resolvedRequestId;
    response.setHeader('x-request-id', resolvedRequestId);

    return next.handle();
  }
}
