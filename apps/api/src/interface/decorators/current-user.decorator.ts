import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import {
  getOptionalChapterId,
  type AppUserContext,
  type RequestContext,
} from '../types/request-context.types';

export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<RequestContext>();
    const user = request.appUser;
    if (!field) {
      return user;
    }
    return user?.[field as keyof AppUserContext];
  },
);

export const CurrentChapterId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<RequestContext>().chapterId;
  },
);

/**
 * Chapter id when one is in context, without requiring ChapterGuard.
 * Used by `GET /v1/analytics/identity` so a missing chapter yields
 * `chapter_group_id: null` instead of 400.
 */
export const OptionalChapterId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    return getOptionalChapterId(
      ctx.switchToHttp().getRequest<RequestContext>(),
    );
  },
);

export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<RequestContext>().member;
  },
);
