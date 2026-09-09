import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_POSTHOG_LOGS_SAMPLE_RATE,
  POSTHOG_EXCEPTION_AUTOCAPTURE,
  SENTRY_ERROR_CORRELATED_EVENT,
  formatSampleRateWarning,
  isPseudonymHex,
  parseSampleRate,
} from '@repo/observability';
import type { AnalyticsEvent } from '@repo/validation';
import { PostHog, type EventMessage } from 'posthog-node';
import type { IAnalyticsProvider } from '#domain/adapters/analytics.interface';
import type { IFeatureFlagProvider } from '#domain/adapters/feature-flag.interface';
import { NoopAnalyticsProvider } from './noop-analytics.provider';
import { NoopFeatureFlagProvider } from './noop-feature-flags.provider';
import { parsePosthogConfig, type PosthogConfig } from './posthog-config';
import type { PosthogFetch } from './posthog-transport';

/**
 * Content-free `sentry-error-correlated` properties named in
 * `spec/behavior/observability.md` § Privacy and replay. Unknown keys are
 * dropped rather than forwarded — exception type, stack, message, body, and
 * query string must never ride along even if a caller passes them.
 */
export const SENTRY_ERROR_CORRELATED_ALLOWLIST = [
  'sentry_event_id',
  'trace_id',
  'request_id',
  'route',
  'status_class',
  'release',
] as const;

export type SentryErrorCorrelatedProperty =
  (typeof SENTRY_ERROR_CORRELATED_ALLOWLIST)[number];

const MARKER_ALLOWLIST = new Set<string>(SENTRY_ERROR_CORRELATED_ALLOWLIST);

export interface SanitizedLogRecord {
  body: string;
  severity: 'INFO' | 'WARN' | 'ERROR';
  attributes: Record<string, string | number | boolean>;
}

export interface PosthogRuntimeOptions {
  config: PosthogConfig;
  fetch?: PosthogFetch;
  flushAt?: number;
  flushInterval?: number;
  fetchRetryCount?: number;
  fetchRetryDelay?: number;
  disableCompression?: boolean;
  logsSampleRate?: number;
}

/**
 * One PostHog Node client for the process: product events, sanitized logs,
 * and server-side flags. Init once. No-op without a valid project key.
 *
 * Do **not** install `@opentelemetry/sdk-node` here. Sentry owns the Node
 * tracer (ADR-22). Logs are an independent HTTP transform to
 * `{host}/i/v1/logs`, not a pipe from Render stdout and not a second OTEL SDK.
 */
export class PosthogRuntime {
  private readonly logger = new Logger(PosthogRuntime.name);
  private readonly client: PostHog;
  private readonly logQueue: SanitizedLogRecord[] = [];
  private logTimer: ReturnType<typeof setTimeout> | undefined;
  private shuttingDown = false;
  /**
   * Last HTTP status from a `/batch/` call. `captureImmediate` swallows
   * `PostHogFetchHttpError` (console.error + resolve), so forget cannot
   * treat "the promise settled" as an ack.
   */
  private lastBatchHttpStatus: number | undefined;

  readonly analytics: IAnalyticsProvider;
  readonly flags: IFeatureFlagProvider;

  constructor(private readonly options: PosthogRuntimeOptions) {
    const userFetch = options.fetch ?? defaultFetch;
    const trackedFetch: PosthogFetch = async (url, init) => {
      const response = await userFetch(url, init);
      if (url.includes('/batch')) {
        this.lastBatchHttpStatus = response.status;
      }
      return response;
    };

    this.client = new PostHog(options.config.apiKey, {
      host: options.config.host,
      fetch: trackedFetch,
      flushAt: options.flushAt ?? 20,
      flushInterval: options.flushInterval ?? 10_000,
      fetchRetryCount: options.fetchRetryCount ?? 3,
      fetchRetryDelay: options.fetchRetryDelay ?? 3_000,
      disableCompression: options.disableCompression ?? false,
      disableGeoip: true,
      enableExceptionAutocapture: POSTHOG_EXCEPTION_AUTOCAPTURE,
      enableLocalEvaluation: false,
      preloadFeatureFlags: false,
      disableRemoteConfig: true,
      disableSurveys: true,
      sendFeatureFlagEvent: false,
      before_send: (event) => this.beforeSend(event),
    });
    this.analytics = new PosthogAnalyticsProvider(this);
    this.flags = new PosthogFeatureFlagAdapter(this);
  }

  get logsSampleRate(): number {
    return this.options.logsSampleRate ?? DEFAULT_POSTHOG_LOGS_SAMPLE_RATE;
  }

  captureEvent(event: AnalyticsEvent): void {
    this.client.capture({
      distinctId: event.distinctId,
      event: event.name,
      properties: {
        ...(event.properties ?? {}),
        $process_person_profile: false,
      },
      sendFeatureFlags: false,
    });
  }

  /**
   * Account-deletion sentinel. Waits for the batch ack (unlike captureEvent)
   * because the auth delete gates on this boolean.
   *
   * `posthog-node`'s `captureImmediate` awaits the wire but swallows HTTP
   * errors, and `flush()` does not join `prepareEventMessage`. Delivery is
   * the last `/batch/` HTTP status after retries.
   */
  async forget(distinctId: string): Promise<boolean> {
    this.lastBatchHttpStatus = undefined;
    try {
      await this.client.captureImmediate({
        distinctId,
        event: 'account-deleted',
        properties: { $process_person_profile: false },
        sendFeatureFlags: false,
      });
      return (
        this.lastBatchHttpStatus !== undefined &&
        this.lastBatchHttpStatus >= 200 &&
        this.lastBatchHttpStatus < 300
      );
    } catch (error) {
      this.logger.warn('PostHog forget flush failed', error as Error);
      return false;
    }
  }

  captureSentryErrorCorrelated(
    distinctId: string,
    properties: Record<string, unknown>,
  ): void {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (!MARKER_ALLOWLIST.has(key)) continue;
      if (typeof value !== 'string' || value.length === 0) continue;
      sanitized[key] = value;
    }
    this.client.capture({
      distinctId,
      event: SENTRY_ERROR_CORRELATED_EVENT,
      properties: {
        ...sanitized,
        $process_person_profile: false,
      },
      sendFeatureFlags: false,
    });
  }

  enqueueSanitizedLog(record: SanitizedLogRecord, sampleKey: string): void {
    if (this.shuttingDown) return;
    if (!shouldSample(sampleKey, this.logsSampleRate)) return;
    this.logQueue.push(record);
    if (this.logQueue.length >= 20) {
      void this.flushLogs();
      return;
    }
    if (!this.logTimer) {
      this.logTimer = setTimeout(() => {
        this.logTimer = undefined;
        void this.flushLogs();
      }, 1_000);
    }
  }

  async isFeatureEnabled(
    flagKey: string,
    distinctId: string,
    chapterGroupId?: string | null,
  ): Promise<boolean> {
    if (!isPseudonymHex(distinctId)) return false;
    if (chapterGroupId && !isPseudonymHex(chapterGroupId)) return false;
    try {
      const enabled = await this.client.isFeatureEnabled(flagKey, distinctId, {
        groups: chapterGroupId ? { chapter: chapterGroupId } : undefined,
        sendFeatureFlagEvents: false,
      });
      return enabled === true;
    } catch (error) {
      this.logger.warn(
        `PostHog flag "${flagKey}" evaluation failed; failing closed`,
        error as Error,
      );
      return false;
    }
  }

  async flush(): Promise<void> {
    // capture() enqueues via prepareEventMessage (microtasks). flush() does
    // not join that queue — only shutdown() does. Yield so a pending item is
    // in the buffer before we drain it. Product capture must still return
    // before this runs; only explicit flush/shutdown wait.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await this.flushLogs();
    await this.client.flush();
  }

  async shutdown(timeoutMs = 5_000): Promise<void> {
    this.shuttingDown = true;
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = undefined;
    }
    await this.flushLogs();
    await Promise.resolve(this.client.shutdown(timeoutMs));
  }

  private beforeSend(event: EventMessage | null): EventMessage | null {
    if (!event) return null;
    if (event.event === '$exception') return null;
    if (event.event === SENTRY_ERROR_CORRELATED_EVENT) {
      const props: Record<string, unknown> = {
        ...((event.properties ?? {}) as Record<string, unknown>),
      };
      const next: Record<string, unknown> = {};
      for (const key of MARKER_ALLOWLIST) {
        const value: unknown = props[key];
        if (typeof value === 'string' && value.length > 0) next[key] = value;
      }
      if (props.$process_person_profile === false) {
        next.$process_person_profile = false;
      }
      return { ...event, properties: next };
    }
    return event;
  }

  private async flushLogs(): Promise<void> {
    if (this.logTimer) {
      clearTimeout(this.logTimer);
      this.logTimer = undefined;
    }
    if (this.logQueue.length === 0) return;
    const batch = this.logQueue.splice(0, this.logQueue.length);
    const url = `${this.options.config.host}/i/v1/logs`;
    const payload = JSON.stringify(buildOtlpLogs(batch));
    const fetchFn = this.options.fetch ?? defaultFetch;
    const retries = this.options.fetchRetryCount ?? 3;
    const delay = this.options.fetchRetryDelay ?? 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.config.apiKey}`,
          },
          body: payload,
        });
        if (res.status >= 200 && res.status < 400) return;
      } catch {
        // retry then drop — logs must not block the request
      }
      if (attempt < retries && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    this.logger.warn(
      `Dropped ${batch.length} sanitized PostHog log record(s) after retries`,
    );
  }
}

@Injectable()
export class PosthogAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(PosthogAnalyticsProvider.name);

  constructor(private readonly runtime: PosthogRuntime) {}

  capture(event: AnalyticsEvent): Promise<void> {
    try {
      this.runtime.captureEvent(event);
    } catch (error) {
      this.logger.warn('PostHog capture enqueue failed', error as Error);
    }
    return Promise.resolve();
  }

  forget(distinctId: string): Promise<boolean> {
    return this.runtime.forget(distinctId);
  }
}

class PosthogFeatureFlagAdapter implements IFeatureFlagProvider {
  constructor(private readonly runtime: PosthogRuntime) {}

  isEnabled(
    flagKey: string,
    distinctId: string,
    chapterGroupId?: string | null,
  ): Promise<boolean> {
    return this.runtime.isFeatureEnabled(flagKey, distinctId, chapterGroupId);
  }
}

class DisabledPosthogRuntime {
  readonly analytics = new NoopAnalyticsProvider();
  readonly flags = new NoopFeatureFlagProvider();

  captureSentryErrorCorrelated(): void {}
  enqueueSanitizedLog(): void {}
  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export type ActivePosthogRuntime = PosthogRuntime | DisabledPosthogRuntime;

let singleton: ActivePosthogRuntime | null = null;

export function getPosthogRuntime(): ActivePosthogRuntime | null {
  return singleton;
}

export async function resetPosthogRuntimeForTests(): Promise<void> {
  const current = singleton;
  singleton = null;
  if (current) {
    await current.shutdown(1_000);
  }
}

export async function shutdownPosthogRuntime(): Promise<void> {
  const current = singleton;
  singleton = null;
  if (current) await current.shutdown();
}

export function startPosthogRuntime(
  options: PosthogRuntimeOptions,
): PosthogRuntime {
  const runtime = new PosthogRuntime(options);
  singleton = runtime;
  return runtime;
}

/**
 * Bind the process-wide runtime from env. Idempotent. Missing / blank /
 * malformed credentials leave a disabled runtime so callers can no-op.
 */
export function ensurePosthogRuntime(
  config: ConfigService,
  extras?: Partial<PosthogRuntimeOptions>,
): ActivePosthogRuntime {
  if (singleton) return singleton;

  const parsed = parsePosthogConfig({
    POSTHOG_API_KEY: config.get<string>('POSTHOG_API_KEY'),
    POSTHOG_HOST: config.get<string>('POSTHOG_HOST'),
  });

  if (!parsed.config) {
    singleton = new DisabledPosthogRuntime();
    return singleton;
  }

  const logsSample = parseSampleRate(
    config.get<string>('POSTHOG_LOGS_SAMPLE_RATE'),
    DEFAULT_POSTHOG_LOGS_SAMPLE_RATE,
  );
  const warning = formatSampleRateWarning(
    'POSTHOG_LOGS_SAMPLE_RATE',
    logsSample,
  );
  if (warning) {
    Logger.warn(warning, 'PosthogRuntime');
  }

  const runtime = new PosthogRuntime({
    config: parsed.config,
    logsSampleRate: logsSample.value,
    ...extras,
  });
  singleton = runtime;
  return runtime;
}

export function captureSentryErrorCorrelated(
  distinctId: string,
  properties: Record<string, unknown>,
): void {
  try {
    singleton?.captureSentryErrorCorrelated(distinctId, properties);
  } catch {
    // Never fail the HTTP response because the marker could not be queued.
  }
}

export function enqueueSanitizedLog(
  record: SanitizedLogRecord,
  sampleKey: string,
): void {
  try {
    singleton?.enqueueSanitizedLog(record, sampleKey);
  } catch {
    // Operational log export must never affect the request.
  }
}

export function shouldSample(key: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const digest = createHash('sha256').update(key).digest();
  const n = digest.readUInt32BE(0) / 0x1_0000_0000;
  return n < rate;
}

function buildOtlpLogs(records: SanitizedLogRecord[]): Record<string, unknown> {
  const now = BigInt(Date.now()) * 1_000_000n;
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: 'frapp-api' },
            },
          ],
        },
        scopeLogs: [
          {
            logRecords: records.map((record, index) => ({
              timeUnixNano: (now + BigInt(index)).toString(),
              severityText: record.severity,
              body: { stringValue: record.body },
              attributes: Object.entries(record.attributes).map(
                ([key, value]) => ({
                  key,
                  value:
                    typeof value === 'number'
                      ? { doubleValue: value }
                      : typeof value === 'boolean'
                        ? { boolValue: value }
                        : { stringValue: String(value) },
                }),
              ),
            })),
          },
        ],
      },
    ],
  };
}

const defaultFetch: PosthogFetch = async (url, options) => {
  const response = await fetch(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
  });
  return {
    status: response.status,
    text: () => response.text(),
    json: () => response.json() as Promise<unknown>,
    headers: {
      get: (name: string) => response.headers.get(name),
    },
  };
};
