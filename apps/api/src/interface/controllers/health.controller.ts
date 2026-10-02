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
// needs a probe taken now.
export const LIVENESS_PROBE_TTL_MS = 60_000;

interface DependencyProbes {
  database: DependencyStatus;
  storage: DependencyStatus;
}

@ApiTags('Health')
@Controller({ version: '' })
export class HealthController {
  private readonly startedAt = Date.now();
  private liveness: {
    probedAt: number;
    probes: Promise<DependencyProbes>;
  } | null = null;

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
    const payload = this.buildPayload(await this.probe());

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
    // This route is public, so the body names only a fixed category: the
    // error's own `code` when it set one, else `misconfigured`. Its message
    // holds the configured STRIPE_PRICE_ID and Stripe's raw error text, which
    // for a revoked key includes the key's type and last four characters
    // (#2999). The service's error log and the Sentry `cause` keep all of it.
    try {
      await this.stripePriceConsistency.assertConfiguredPrice();
    } catch (err) {
      if (err instanceof StripePriceAccountMismatchError) {
        throw new ServiceUnavailableException(
          {
            code: 'DEGRADED',
            message: `database: ${payload.database}, storage: ${payload.storage}, billing: ${err.code ?? 'misconfigured'}`,
          },
          { cause: toReportableError(err) },
        );
      }
      throw err;
    }

    return payload;
  }

  // The promise is what is cached, so callers arriving while a probe is in
  // flight share it rather than each starting their own. `probe` never
  // rejects (every arm resolves to a status), so a cached failure is a
  // reported `'error'`, never a rejection replayed for the whole TTL. The age
  // is read off the monotonic clock, so a wall-clock step back cannot stretch
  // the TTL.
  private cachedProbes(): Promise<DependencyProbes> {
    const now = performance.now();
    if (this.liveness && now - this.liveness.probedAt < LIVENESS_PROBE_TTL_MS) {
      return this.liveness.probes;
    }
    const probes = this.probe();
    this.liveness = { probedAt: now, probes };
    return probes;
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
