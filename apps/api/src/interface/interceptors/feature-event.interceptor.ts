import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { AnalyticsProperties } from '@repo/validation';
import { AnalyticsService } from '../../application/services/analytics.service';
import { FEATURE_EVENTS } from '#domain/constants/feature-events';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import {
  featureEventsOf,
  type FeatureEventInput,
  type FeatureEventMetadata,
} from '../decorators/feature-event.decorator';
import { requestApp } from '../http/request-app';
import { signInMethodOf } from '../http/sign-in-method';
import type { RequestContext } from '../types/request-context.types';

/**
 * Sends a handler's `@FeatureEvent` (#593) once the handler succeeds.
 *
 * Registered globally (`APP_INTERCEPTOR` in `AnalyticsModule`), and a no-op
 * for a handler without the decorator. For one with it:
 *
 *  - Success only. The event is built in `tap`'s `next`, which runs when the
 *    handler's result arrives; a thrown handler reaches `error` instead and
 *    records nothing.
 *  - Never in the request's way. Building the event is wrapped so a describer
 *    bug is logged, not thrown, and `track` is not awaited: the response
 *    doesn't wait on PostHog.
 *  - The acting user is `request.appUser`, read at that point rather than on
 *    the way in: on a route using `AuthSyncInterceptor`, that controller-scoped
 *    interceptor sets it after this global one has already run.
 *  - The chapter is `ChapterGuard`'s verified `request.chapterId`, or the
 *    decorator's `chapterId` option on a route without the guard. No chapter,
 *    no event: there would be no opt-out to check.
 *  - Properties outside the event's allowlist are dropped and logged (the
 *    decorator's types already refuse them), and `feature` is added.
 *  - `app` comes from the request (`requestApp`).
 *  - The chapter's opt-out is `track`'s to check, read when the event is sent,
 *    after the handler: an action that opts the chapter out is not recorded,
 *    nor is one that finishes after another request opted it out.
 *
 * Canonical behavior: `spec/behavior/observability.md` § Feature Events.
 */
@Injectable()
export class FeatureEventInterceptor implements NestInterceptor {
  private readonly logger = new Logger(FeatureEventInterceptor.name);

  constructor(private readonly analytics: AnalyticsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const events = featureEventsOf(context.getHandler());
    if (events.length === 0 || context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestContext>();
    return next.handle().pipe(
      tap({
        next: (result: unknown) => {
          for (const metadata of events) this.record(metadata, request, result);
        },
      }),
    );
  }

  private record(
    metadata: FeatureEventMetadata,
    request: RequestContext,
    result: unknown,
  ): void {
    const { name } = metadata;
    try {
      const userId = request.appUser?.id;
      if (!userId) return;

      const input: FeatureEventInput = {
        body: request.body,
        params: request.params ?? {},
        query: request.query ?? {},
        result,
        signInMethod: signInMethodOf(request.supabaseUser),
      };
      const described = metadata.describe ? metadata.describe(input) : {};
      if (described === null) return;

      const chapterId = metadata.chapterId
        ? metadata.chapterId(input)
        : request.chapterId;
      if (!chapterId) return;

      const definition = FEATURE_EVENTS[name];
      const allowed: readonly string[] = definition.properties;
      const properties: AnalyticsProperties = { feature: definition.feature };
      const dropped: string[] = [];
      for (const [key, value] of Object.entries(described)) {
        if (allowed.includes(key)) properties[key] = value;
        else dropped.push(key);
      }
      if (dropped.length > 0) {
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: `feature-event-undeclared-properties:${name}`,
          message: `Feature event "${name}" dropped undeclared properties: ${dropped.join(', ')}`,
        });
      }

      this.analytics
        .track(name, userId, {
          chapterId,
          properties,
          app: requestApp(request),
        })
        .catch((error: unknown) => {
          reportCaughtFailure(this.logger, {
            level: 'error',
            site: 'feature-event-track-rejected',
            message: `Feature event "${name}" was rejected`,
            error,
          });
        });
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'feature-event-build-failed',
        message: `Feature event "${name}" could not be built`,
        error,
      });
    }
  }
}
