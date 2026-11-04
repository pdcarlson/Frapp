import type { Logger } from '@nestjs/common';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportSwallowed } from '../../infrastructure/observability/report-swallowed';

/**
 * Failed statuses in a row, with no `SUBSCRIBED` between them, after which the
 * subscription counts as down and Sentry hears about it at error level.
 *
 * A routine Realtime blip is one `CHANNEL_ERROR` that rejoins about a second
 * later (prod logs, 2026-11-02 to 11-04, about 40 of them). Five failures in a
 * row is about 20 s of rejoins on realtime-js's own schedule, or about 15 s of
 * reopens on {@link reopenDelayMs}'s, so it is a real outage.
 */
export const WORKER_SUBSCRIPTION_DOWN_AFTER = 5;

/** The first reopen after a server close waits this long. */
export const WORKER_REOPEN_BASE_DELAY_MS = 1_000;

/** Reopens back off by doubling, and never wait longer than this. */
export const WORKER_REOPEN_MAX_DELAY_MS = 60_000;

/**
 * Sentry reports for one subscription, at most one per status per window. A
 * dropped socket fails a channel once per rejoin, and one event says as much
 * as twenty.
 */
export const WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS = 10 * 60 * 1000;

/** How long the reopen after `reopens` failed reopens in a row waits. */
export function reopenDelayMs(reopens: number): number {
  return Math.min(
    WORKER_REOPEN_BASE_DELAY_MS * 2 ** Math.min(reopens, 16),
    WORKER_REOPEN_MAX_DELAY_MS,
  );
}

export interface WorkerSubscriptionConfig {
  /** The Realtime topic. One per worker; nothing else may open it. */
  topic: string;
  /** Names the worker in logs and in Sentry's `worker` tag. */
  worker: string;
  /** What stops while the subscription is down, e.g. `chat pushes`. */
  impact: string;
  /**
   * Registers the listeners on a fresh channel. Called once per channel, before
   * `subscribe()`, so a reopen gets its listeners back.
   */
  bind: (channel: RealtimeChannel) => RealtimeChannel;
  logger: Logger;
}

/**
 * A long-lived worker's Realtime subscription that survives the server
 * ending it (#3365).
 *
 * realtime-js retries some failures itself and not others, so this only adds
 * what it lacks:
 *
 * - `CHANNEL_ERROR` and `TIMED_OUT` leave the channel `errored`, and
 *   phoenix's rejoin timer joins it again on its own (1 s, 2 s, 5 s, then every
 *   10 s), or as soon as the socket reopens. A second join from here would race
 *   that one, so the channel is kept and the failure is only logged and
 *   reported.
 * - `CLOSED` on a channel this worker still holds is the server ending it.
 *   phoenix resets the rejoin timer on close and realtime-js drops the channel
 *   from its client, so nothing ever joins it again: before this, chat pushes
 *   (or the audit mirror) stopped there until the next deploy, with one warn
 *   line. So the topic is freed and reopened on a fresh channel, backing off
 *   from {@link WORKER_REOPEN_BASE_DELAY_MS} to {@link WORKER_REOPEN_MAX_DELAY_MS},
 *   forever. A worker that stops trying is a worker that is down until
 *   someone restarts it.
 *
 * Every failure is logged, and reported to Sentry as a warning at most once per
 * {@link WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS} per status. After
 * {@link WORKER_SUBSCRIPTION_DOWN_AFTER} in a row with no `SUBSCRIBED` it is an
 * outage, reported at error level instead, on the same window. That error
 * event is the signal that the worker is down: `/health/ready` does not
 * include it (`docs/ops/deployment/render.md` § 5.5).
 *
 * Inserts made while the subscription is down are never delivered later:
 * postgres_changes does not replay. Each failure's log line says so.
 *
 * Only this instance opens its topic, so the channel it holds is the only one
 * that topic has. Freeing it before a reopen is `realtime-resilience` rule 1:
 * `unsubscribe()` and then an unconditional `teardown()`, because a channel
 * still registered is handed back by the next `supabase.channel()` on its
 * topic, and realtime-js's `_remove` drops every channel with the topic, so a
 * late close of the old one would unregister the new one.
 */
export class WorkerSubscription {
  /** The channel this worker holds. Null between a close and its reopen. */
  private channel: RealtimeChannel | null = null;
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Failed statuses and opens since the last `SUBSCRIBED`. */
  private failures = 0;
  /** Reopens in a row that ended without a `SUBSCRIBED`, for the backoff. */
  private reopens = 0;
  private readonly lastReportAt = new Map<string, number>();

  constructor(
    private readonly supabase: FrappSupabaseClient,
    private readonly config: WorkerSubscriptionConfig,
  ) {}

  /** Opens the subscription. A second call while one is held does nothing. */
  start(): void {
    if (this.stopped || this.channel || this.reopenTimer) return;
    this.open();
  }

  /**
   * Shutdown. Cancels a pending reopen and removes the channel. The `CLOSED`
   * its own leave echoes back is ignored, because the channel is let go of
   * first.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reopenTimer) {
      clearTimeout(this.reopenTimer);
      this.reopenTimer = null;
    }
    const ch = this.channel;
    this.channel = null;
    if (!ch) return;
    try {
      await this.supabase.removeChannel(ch);
    } catch (err) {
      logThrowable(
        this.config.logger,
        'warn',
        `${this.config.worker}: error removing ${this.config.topic} on shutdown`,
        err,
      );
    }
  }

  private open(): void {
    if (this.stopped) return;
    const { topic, worker, impact, logger } = this.config;
    let ch: RealtimeChannel | null = null;
    try {
      const fresh = this.supabase.channel(topic);
      ch = fresh;
      this.config.bind(fresh);
      // Held before `subscribe()`, so a status that arrives at once finds it.
      this.channel = fresh;
      fresh.subscribe((status: string, err?: Error) =>
        this.onStatus(fresh, status, err),
      );
    } catch (err) {
      logThrowable(
        logger,
        'error',
        `${worker}: failed to open ${topic}; ${impact} stop until it opens`,
        err,
      );
      this.channel = null;
      this.recordFailure('OPEN_FAILED');
      // A throw here is most often `.on()` refusing a channel that is already
      // subscribed: a leftover still registered on this topic, which
      // `channel()` handed back. Freeing it is what lets the retry work.
      if (ch) void this.releaseThenReopen(ch);
      else this.scheduleReopen();
    }
  }

  private onStatus(ch: RealtimeChannel, status: string, err?: Error): void {
    // A channel this worker already let go of (a close it is reopening from,
    // or shutdown): its own teardown echoing back.
    if (this.stopped || ch !== this.channel) return;
    const { topic, worker, logger } = this.config;

    if (status === 'SUBSCRIBED') {
      logger.log(
        this.failures > 0
          ? `${worker} subscribed to ${topic} again, after ${this.failures} failed in a row`
          : `${worker} subscribed to ${topic}`,
      );
      this.failures = 0;
      this.reopens = 0;
      return;
    }

    this.recordFailure(status, err);
    if (status === 'CLOSED') {
      this.channel = null;
      void this.releaseThenReopen(ch);
    }
  }

  private recordFailure(status: string, err?: Error): void {
    const { topic, worker, impact, logger } = this.config;
    this.failures += 1;
    const detail = err instanceof Error ? ` (${err.message})` : '';
    const next =
      status === 'CLOSED' || status === 'OPEN_FAILED'
        ? 'this worker reopens it'
        : 'realtime-js rejoins it';
    logger.warn(
      `${worker}: ${topic} ${status}${detail}; ${impact} stop until ${next}, and inserts meanwhile are not replayed (${this.failures} failed in a row)`,
    );

    const down = this.failures >= WORKER_SUBSCRIPTION_DOWN_AFTER;
    const key = down ? 'DOWN' : status;
    const now = Date.now();
    if (
      now - (this.lastReportAt.get(key) ?? Number.NEGATIVE_INFINITY) <
      WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS
    ) {
      return;
    }
    this.lastReportAt.set(key, now);
    const failures = String(this.failures);
    reportSwallowed(logger, `the ${worker} subscription`, () =>
      down
        ? {
            message: `${worker} realtime subscription is down; ${impact} are not being sent`,
            level: 'error',
            tags: { worker, realtime_status: status, failures },
            fingerprint: ['worker-subscription-down', worker],
          }
        : {
            message: `${worker} realtime subscription ${status}`,
            level: 'warning',
            tags: { worker, realtime_status: status, failures },
            fingerprint: ['worker-subscription-status', worker, status],
          },
    );
  }

  /**
   * Free the topic (`realtime-resilience` rule 1), then schedule the reopen.
   * The reopen waits for the release, so a fresh channel never meets the one
   * it replaces.
   */
  private async releaseThenReopen(ch: RealtimeChannel): Promise<void> {
    try {
      await ch.unsubscribe();
    } catch {
      // Already gone, or the socket is down; the teardown is what counts.
    }
    try {
      ch.teardown();
    } catch {
      // Already torn down.
    }
    this.scheduleReopen();
  }

  private scheduleReopen(): void {
    if (this.stopped || this.reopenTimer) return;
    const delay = reopenDelayMs(this.reopens);
    this.reopens += 1;
    this.config.logger.warn(
      `${this.config.worker}: reopening ${this.config.topic} in ${delay} ms`,
    );
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      this.open();
    }, delay);
  }
}
