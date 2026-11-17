import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { readDeployedCommit } from '../../infrastructure/observability/deployed-commit';
import { toReportableError } from '../../infrastructure/observability/reportable-error';
import { StripePriceConsistencyService } from '../../infrastructure/billing/stripe-price-consistency.service';
import { StripePriceAccountMismatchError } from '../../infrastructure/billing/stripe-price-consistency';
import { HealthPayloadDto, type DependencyStatus } from '../dtos/health.dto';

// The Supabase client (apps/api/src/infrastructure/supabase/supabase.provider.ts)
// sets no `db.timeout`, so a probe's underlying fetch has no bound of its own —
// a reachable-but-slow dependency would otherwise hang this route indefinitely.
// Bounding each probe keeps /health fast and 2xx even when a dependency stalls,
// which is the whole point of it being a liveness check.
const PROBE_TIMEOUT_MS = 3000;

// How long `/health` reuses one probe result. Render calls it every 5 seconds
// and every open web or mobile client every 30, and no automated caller reads
// the dependency fields: they act on the status code, which is 2xx either way.
// Probing per call made each hit two Supabase requests, and at that cadence
// each opened a fresh TLS connection, because undici drops a socket after 4
// idle seconds. Measured against Supabase (2026-09-29), that is ~2.4 KB sent
// per probe before TCP/IP headers, which puts the probes at an estimated 60%
// of an idle instance's ~6.5 MB/hour of billed Render egress. `/health/ready`
// never uses this cache: the deploy gate, and anyone checking a recovery,
// needs a probe taken moments ago, which `READINESS_PROBE_TTL_MS` keeps.
export const LIVENESS_PROBE_TTL_MS = 60_000;

// How long `/health/ready` reuses its own database and Storage probe. The
// route is public, and probing per call made every hit, from anyone, two
// Supabase requests. Five seconds is shorter than any of its callers' own
// intervals (the uptime monitor's minute, the deploy gate's poll), so each of
// them still sees a probe taken for it, and an outage or a recovery shows
// within five seconds.
export const READINESS_PROBE_TTL_MS = 5_000;

// How long `/health/ready` reuses the Stripe Price check, a call to Stripe's
// API. A Price is changed by hand in Stripe's dashboard (and the configured id
// only by a deploy, which starts a new process and checks again at boot), so a
// result five minutes old is still a true answer for the uptime monitor.
export const STRIPE_CHECK_TTL_MS = 5 * 60_000;

// One reused probe. The promise is what is cached, so callers arriving while
// a probe is in flight share it rather than each starting their own. Every
// probe cached here resolves to its answer (a status, or the Stripe
// mismatch), so a cached failure is that answer, never a rejection replayed
// for the whole TTL; a probe that rejects anyway is dropped at once. The age
// is read off the monotonic clock, so a wall-clock step back cannot stretch
// the TTL.
class ProbeCache<T> {
  private entry: { probedAt: number; result: Promise<T> } | null = null;

  constructor(private readonly ttlMs: number) {}

  get(run: () => Promise<T>): Promise<T> {
    const now = performance.now();
    if (this.entry && now - this.entry.probedAt < this.ttlMs) {
      return this.entry.result;
    }
    const entry = { probedAt: now, result: run() };
    this.entry = entry;
    void entry.result.catch(() => {
      if (this.entry === entry) this.entry = null;
    });
    return entry.result;
  }
}

interface DependencyProbes {
  database: DependencyStatus;
  storage: DependencyStatus;
}

@ApiTags('Health')
@Controller({ version: '' })
export class HealthController {
  private readonly startedAt = Date.now();
  private readonly liveness = new ProbeCache<DependencyProbes>(
    LIVENESS_PROBE_TTL_MS,
  );
  private readonly readiness = new ProbeCache<DependencyProbes>(
    READINESS_PROBE_TTL_MS,
  );
  private readonly stripeCheck =
    new ProbeCache<StripePriceAccountMismatchError | null>(STRIPE_CHECK_TTL_MS);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly stripePriceConsistency: StripePriceConsistencyService,
  ) {}

  // Render's `healthCheckPath` (render.yaml) points at this route. It must
  // always return 2xx — a degraded 503 here would make Render treat the
  // instance as unhealthy and can trigger a rollback, which is a deliberate
  // dashboard-side decision this endpoint must not make unilaterally.
  @Get('health')
  @ApiOperation({
    summary: 'Liveness check (always 2xx while the process is up)',
  })
  @ApiOkResponse({ type: HealthPayloadDto })
  async check(): Promise<HealthPayloadDto> {
    return this.buildPayload(await this.cachedProbes());
  }

  // Strict readiness: the deploy smoke checks (deploy-staging.yml, deploy-production.yml)
  // hit this path instead of /health so a degraded dependency actually fails the gate.
  //
  // The global AllExceptionsFilter sends only its documented error body
  // (spec/architecture/README.md § Error responses) and drops any other key,
  // so the degraded detail travels in `message`, a plain string, while
  // `code: 'DEGRADED'` names the failure.
  @Get('health/ready')
  @ApiOperation({
    summary: 'Readiness check (503 when a dependency is degraded)',
  })
  @ApiOkResponse({ type: HealthPayloadDto })
  async ready(): Promise<HealthPayloadDto> {
    const payload = this.buildPayload(
      await this.readiness.get(() => this.probe()),
    );

    if (payload.status === 'degraded') {
      throw new ServiceUnavailableException({
        code: 'DEGRADED',
        message: `database: ${payload.database}, storage: ${payload.storage}`,
      });
    }

    // Stripe is not a `/health` probe: Render's healthCheckPath must stay 2xx
    // through a Stripe blip. Deploy smoke and production uptime poll this path,
    // so a Price/account mismatch (resource_missing / inactive) 503s here —
    // and `StripePriceConsistencyService.onModuleInit` already refused boot.
    //
    // This route is public, so the body names only the error's `category`,
    // never its message (#2999). The service's error log and the Sentry
    // `cause` keep the full detail.
    const mismatch = await this.stripeCheck.get(() => this.checkStripePrice());
    if (mismatch) {
      throw new ServiceUnavailableException(
        {
          code: 'DEGRADED',
          message: `database: ${payload.database}, storage: ${payload.storage}, billing: ${mismatch.category}`,
        },
        { cause: toReportableError(mismatch) },
      );
    }

    return payload;
  }

  private cachedProbes(): Promise<DependencyProbes> {
    return this.liveness.get(() => this.probe());
  }

  // The Stripe Price check's answer: the mismatch that should 503 the route,
  // or null when the Price is fine (or Stripe could not be reached, which the
  // service logs and lets pass, as at boot). Anything else it throws is not a
  // verdict and is rethrown.
  private async checkStripePrice(): Promise<StripePriceAccountMismatchError | null> {
    try {
      await this.stripePriceConsistency.assertConfiguredPrice();
      return null;
    } catch (err) {
      if (err instanceof StripePriceAccountMismatchError) {
        return err;
      }
      throw err;
    }
  }

  private async probe(): Promise<DependencyProbes> {
    const [database, storage] = await Promise.all([
      this.probeDatabase(),
      this.probeStorage(),
    ]);
    return { database, storage };
  }

  private buildPayload({
    database,
    storage,
  }: DependencyProbes): HealthPayloadDto {
    const payload: HealthPayloadDto = {
      status:
        database === 'connected' && storage === 'connected' ? 'ok' : 'degraded',
      database,
      storage,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
    const commit = readDeployedCommit();
    if (commit) {
      payload.commit = commit;
    }
    return payload;
  }

  private async probeDatabase(): Promise<DependencyStatus> {
    return withTimeout(
      (async () => {
        try {
          const { error } = await this.supabase
            .from('chapters')
            .select('id')
            .limit(1);
          return error ? 'error' : 'connected';
        } catch {
          return 'error';
        }
      })(),
    );
  }

  private async probeStorage(): Promise<DependencyStatus> {
    return withTimeout(
      (async () => {
        try {
          const { error } = await this.supabase.storage.listBuckets();
          return error ? 'error' : 'connected';
        } catch {
          return 'error';
        }
      })(),
    );
  }
}

// A timed-out probe resolves to 'error' rather than rejecting or hanging — the
// underlying call is left to settle in the background (it is a side-effect-free
// read), but the response to the caller is never blocked on it past the bound.
// The timer is cleared on the fast path so a quick probe doesn't leave a
// dangling 3-second handle behind it.
function withTimeout(
  probe: Promise<DependencyStatus>,
): Promise<DependencyStatus> {
  return new Promise<DependencyStatus>((resolve) => {
    const timer = setTimeout(() => resolve('error'), PROBE_TIMEOUT_MS);
    void probe.then((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}
