import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AppUserContext,
  RequestContext,
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

export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest<RequestContext>().member;
  },
);
