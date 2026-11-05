import type { Logger } from '@nestjs/common';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportSwallowed } from '../../infrastructure/observability/report-swallowed';

/**
 * How long a subscription may go without `SUBSCRIBED` before it counts as
 * down and Sentry hears about it at error level.
 *
 * Measured in time, not in failed statuses, because a long outage sends few of
 * them. When the socket drops, phoenix errors each joined channel once and then
 * waits for the socket to reopen, so an hour with Realtime unreachable is one
 * `CHANNEL_ERROR` (`realtime-js-contract.spec.ts` pins this). A routine blip
 * rejoins about a second after its `CHANNEL_ERROR` (prod logs, 2026-11-02 to
 * 11-04, about 40 of them), far inside a minute.
 */
export const WORKER_SUBSCRIPTION_DOWN_AFTER_MS = 60_000;

/** The first reopen after a server close waits this long. */
export const WORKER_REOPEN_BASE_DELAY_MS = 1_000;

/** Reopens back off by doubling, and never wait longer than this. */
export const WORKER_REOPEN_MAX_DELAY_MS = 60_000;

/**
 * Warning reports for one subscription, at most one per status per window, and
 * the outage report repeats on the same window while the outage lasts. Blips
 * come in runs, and one event says as much as twenty.
 */
export const WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS = 10 * 60 * 1000;

/** How long the reopen after `reopens` failed reopens in a row waits. */
export function reopenDelayMs(reopens: number): number {
  return Math.min(
    WORKER_REOPEN_BASE_DELAY_MS * 2 ** Math.min(reopens, 16),
    WORKER_REOPEN_MAX_DELAY_MS,
  );
}

/**
 * Free a channel's topic (`realtime-resilience` rule 1): `unsubscribe()`, then
 * an unconditional `teardown()`.
 *
 * `removeChannel()` only tears down when the leave is acknowledged `ok`, and a
 * channel left registered hands itself back to the next `supabase.channel()` on
 * its topic. phoenix 0.4.5 counts every leave as acked at once
 * (`realtime-js-contract.spec.ts`), but nothing here leans on that: a version
 * that waits for the server would make the unconditional teardown the one that
 * frees the topic.
 *
 * This is chat-core's `releaseTopic`, which the API can't import:
 * chat-core ships TypeScript source for the bundler-built clients, and the
 * API's compiled output can't load it. Every release that a reopen can follow
 * goes through this one: this class's reopens, after a `CLOSED` or a failed
 * open, and the push worker's presence release. Shutdown frees channels with `removeChannel`,
 * because nothing opens their topics again in that process.
 */
export async function releaseChannel(ch: RealtimeChannel): Promise<void> {
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
 * realtime-js retries some failures itself and not others
 * (`realtime-js-contract.spec.ts` pins which), so this only adds what it lacks:
 *
 * - `CHANNEL_ERROR` and `TIMED_OUT` leave the channel `errored`, and phoenix's
 *   rejoin timer joins it again by itself (1 s, 2 s, 5 s, then every 10 s), or
 *   as soon as the socket reopens. A second join from here would race that one,
 *   so the channel is kept and the failure is only logged and reported.
 * - `CLOSED` on a channel this worker still holds is the server ending it.
 *   phoenix resets the rejoin timer on close and realtime-js drops the channel
 *   from its client, so nothing ever joins it again: before this, chat pushes
 *   (or the audit mirror) stopped there until the next deploy, with one warn
 *   line. So the topic is freed with {@link releaseChannel} and reopened on a
 *   fresh channel, backing off from {@link WORKER_REOPEN_BASE_DELAY_MS} to
 *   {@link WORKER_REOPEN_MAX_DELAY_MS}, forever. A worker that stops trying is
 *   a worker that is down until someone restarts it.
 *
 * Every failure is logged, and reported to Sentry as a warning at most once per
 * {@link WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS} per status. A subscription
 * that has gone {@link WORKER_SUBSCRIPTION_DOWN_AFTER_MS} without `SUBSCRIBED`,
 * from boot or from its first failure, is an outage: that is logged and
 * reported at error level, and again every
 * {@link WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS} while it lasts. The error
 * event is the signal that the worker is down, because `/health/ready` leaves
 * the subscriptions out (`spec/behavior/observability.md` § Health Check).
 *
 * Inserts made while the subscription is down are never delivered later:
 * postgres_changes does not replay. Each failure's log line says so.
 *
 * Only this instance opens its topic, so the channel it holds is the only one
 * that topic has. The reopen waits for the release, because a channel still
 * registered is handed back by the next `supabase.channel()` on its topic, and
 * realtime-js's `_remove` drops every channel with the topic, so a late close of
 * the old one would unregister the new one.
 */
export class WorkerSubscription {
  /** The channel this worker holds. Null between a close and its reopen. */
  private channel: RealtimeChannel | null = null;
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending outage report; armed whenever the subscription isn't subscribed. */
  private outageTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private subscribed = false;
  /** When the current spell without `SUBSCRIBED` began: boot, or a failure. */
  private downSince = 0;
  /** Failed statuses and opens since the last `SUBSCRIBED`. */
  private failures = 0;
  /** The most recent failure since the last `SUBSCRIBED`, for the outage report. */
  private lastFailure = 'NONE';
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
    this.markDown();
    this.open();
  }

  /**
   * Shutdown. Cancels a pending reopen and outage report, and removes the
   * channel. The `CLOSED` its own leave echoes back is ignored, because the
   * channel is let go of first.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of [this.reopenTimer, this.outageTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.reopenTimer = null;
    this.outageTimer = null;
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
      // caught-failure-exempt: recordFailure reports it below; an outage reports at error
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
      this.subscribed = true;
      this.failures = 0;
      this.lastFailure = 'NONE';
      this.reopens = 0;
      if (this.outageTimer) clearTimeout(this.outageTimer);
      this.outageTimer = null;
      return;
    }

    this.recordFailure(status, err);
    if (status === 'CLOSED') {
      this.channel = null;
      void this.releaseThenReopen(ch);
    }
  }

  /** Start the clock on a spell without `SUBSCRIBED`, if one isn't running. */
  private markDown(): void {
    this.subscribed = false;
    if (this.stopped || this.outageTimer) return;
    this.downSince = Date.now();
    this.outageTimer = backgroundTimer(
      () => this.reportOutage(),
      WORKER_SUBSCRIPTION_DOWN_AFTER_MS,
    );
  }

  private recordFailure(status: string, err?: Error): void {
    const { topic, worker, impact, logger } = this.config;
    this.markDown();
    this.failures += 1;
    this.lastFailure = status;
    const detail = err instanceof Error ? ` (${err.message})` : '';
    const next =
      status === 'CLOSED' || status === 'OPEN_FAILED'
        ? 'this worker reopens it'
        : 'realtime-js rejoins it';
    logger.warn(
      `${worker}: ${topic} ${status}${detail}; ${impact} stop until ${next}, and inserts meanwhile are not replayed (${this.failures} failed in a row)`,
    );

    const now = Date.now();
    if (
      now - (this.lastReportAt.get(status) ?? Number.NEGATIVE_INFINITY) <
      WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS
    ) {
      return;
    }
    this.lastReportAt.set(status, now);
    const failures = String(this.failures);
    reportSwallowed(logger, `the ${worker} subscription`, () => ({
      message: `${worker} realtime subscription ${status}`,
      level: 'warning',
      tags: { worker, realtime_status: status, failures },
      fingerprint: ['worker-subscription-status', worker, status],
    }));
  }

  /**
   * The subscription has gone {@link WORKER_SUBSCRIPTION_DOWN_AFTER_MS} without
   * `SUBSCRIBED`. Reported now, and again every
   * {@link WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS} until it subscribes.
   */
  private reportOutage(): void {
    this.outageTimer = null;
    if (this.stopped || this.subscribed) return;
    const { topic, worker, impact, logger } = this.config;
    const downForS = Math.round((Date.now() - this.downSince) / 1000);
    const lastFailure = this.lastFailure;
    const failures = String(this.failures);
    // caught-failure-exempt: reported by reportSwallowed below
    logger.error(
      `${worker}: ${topic} has not been subscribed for ${downForS} s (last status ${lastFailure}, ${failures} failed); ${impact} are not being sent`,
    );
    reportSwallowed(logger, `the ${worker} subscription outage`, () => ({
      message: `${worker} realtime subscription is down; ${impact} are not being sent`,
      level: 'error',
      tags: { worker, realtime_status: lastFailure, failures },
      fingerprint: ['worker-subscription-down', worker],
    }));
    this.outageTimer = backgroundTimer(
      () => this.reportOutage(),
      WORKER_SUBSCRIPTION_REPORT_INTERVAL_MS,
    );
  }

  /** Free the topic, then schedule the reopen, so the reopen waits for it. */
  private async releaseThenReopen(ch: RealtimeChannel): Promise<void> {
    await releaseChannel(ch);
    this.scheduleReopen();
  }

  private scheduleReopen(): void {
    if (this.stopped || this.reopenTimer) return;
    const delay = reopenDelayMs(this.reopens);
    this.reopens += 1;
    this.config.logger.warn(
      `${this.config.worker}: reopening ${this.config.topic} in ${delay} ms`,
    );
    this.reopenTimer = backgroundTimer(() => {
      this.reopenTimer = null;
      this.open();
    }, delay);
  }
}

/**
 * A timer that never keeps the process alive by itself. The HTTP server does
 * that; a pending reopen or outage check must not hold a draining process, or
 * a test run, open after everything else has stopped.
 */
export function backgroundTimer(
  fn: () => void,
  ms: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}
