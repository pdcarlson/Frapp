import type {
  FeatureEventName,
  FeatureEventProperties,
  FeatureEventPropertyKey,
} from '#domain/constants/feature-events';

export const FEATURE_EVENT_KEY = 'feature_event';

/**
 * What a describer sees: the request and the handler's result.
 *
 * `body` and `query` are the request as sent, not the DTO instance the handler
 * got. Interceptors run before pipes, so the `ValidationPipe` has refused any
 * undeclared key (`forbidNonWhitelisted`) by the time a describer runs, but
 * has not converted values or applied defaults on this copy. Type `body` with
 * the DTO for its keys, and stick to presence, length and enum checks that
 * hold on raw JSON.
 */
export interface FeatureEventInput<TBody = unknown, TResult = unknown> {
  body: TBody;
  params: Record<string, string | string[]>;
  query: Record<string, unknown>;
  result: TResult;
}

/**
 * `P`, refusing any key outside event `N`'s allowlist: an undeclared key is
 * typed `never`, so returning `{ title: 'x' }` is a compile error.
 */
export type CheckedFeatureEventProperties<N extends FeatureEventName, P> = P & {
  [X in Exclude<keyof P, FeatureEventPropertyKey<N>>]: never;
};

export interface FeatureEventOptions<TBody = unknown, TResult = unknown> {
  /**
   * The chapter the event belongs to, for a route with no `ChapterGuard`
   * (where `request.chapterId` is unset). Otherwise the guard's verified
   * chapter is used. An event with no chapter is not sent.
   */
  chapterId?: (input: FeatureEventInput<TBody, TResult>) => string | undefined;
}

export interface FeatureEventMetadata {
  name: FeatureEventName;
  describe?: (
    input: FeatureEventInput,
  ) => Record<string, string | number | boolean | null> | null;
  chapterId?: (input: FeatureEventInput) => string | undefined;
}

/** The `@FeatureEvent`s on one handler, in no particular order. */
export function featureEventsOf(
  handler: unknown,
): readonly FeatureEventMetadata[] {
  if (typeof handler !== 'function') return [];
  return (
    (Reflect.getMetadata(FEATURE_EVENT_KEY, handler) as
      FeatureEventMetadata[] | undefined) ?? []
  );
}

/**
 * Record this handler's success as a feature event (#593). The catalog is
 * `FEATURE_EVENTS` (`#domain/constants/feature-events`); the interceptor that
 * sends it is `FeatureEventInterceptor`.
 *
 * A handler may carry several, each deciding for itself whether it applies:
 * a chat send is always `message-sent`, and also `poll-created` when the
 * message is a poll.
 *
 * `describe` returns the event's properties from the request body, the route
 * params and query, and the handler's result, or `null` to send nothing (a
 * deduplicated retry, say). It runs after the handler succeeds; a failed
 * request records nothing. Type the input to get the body and result typed:
 *
 * ```ts
 * @FeatureEvent('task-created', ({ body }: FeatureEventInput<CreateTaskDto>) => ({
 *   has_assignee: !!body.assignee_id,
 * }))
 * ```
 */
export function FeatureEvent<
  N extends FeatureEventName,
  TBody = unknown,
  TResult = unknown,
  P extends FeatureEventProperties<N> = FeatureEventProperties<N>,
>(
  name: N,
  describe?: (
    input: FeatureEventInput<TBody, TResult>,
  ) => CheckedFeatureEventProperties<N, P> | null,
  options: FeatureEventOptions<TBody, TResult> = {},
): MethodDecorator {
  const metadata: FeatureEventMetadata = {
    name,
    describe,
    chapterId: options.chapterId,
  };
  return (_target, _key, descriptor) => {
    const handler: unknown = descriptor.value;
    if (typeof handler !== 'function') return descriptor;
    Reflect.defineMetadata(
      FEATURE_EVENT_KEY,
      [...featureEventsOf(handler), metadata],
      handler,
    );
    return descriptor;
  };
}
