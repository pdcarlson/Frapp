import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped facts that Nest `Logger` records can read without holding
 * the Express request.
 *
 * `spec/behavior/observability.md` § Request Tracing requires the id in
 * **all** log entries, not only the HTTP interceptor's JSON line. Service
 * loggers (`new Logger(FooService.name)`) never see `req`. Binding the store
 * in `requestIdMiddleware` — still Express middleware, so denials have an id
 * — is what makes that true. The store is request-id only: raw user/chapter
 * ids already travel on the interceptor / security-event JSON, and putting
 * them on every Nest prefix would duplicate them into lines that never
 * asked.
 *
 * `x-request-id` is not a Sentry/OTEL trace id (ADR-22). This store must
 * never be filled from `sentry-trace` / `baggage`.
 */
export interface RequestLogStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestLogStore>();

export function runWithRequestLogStore<T>(
  store: RequestLogStore,
  fn: () => T,
): T {
  return storage.run(store, fn);
}

export function getRequestLogStore(): RequestLogStore | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
