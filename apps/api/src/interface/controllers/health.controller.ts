import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

type DependencyStatus = 'connected' | 'error';

interface HealthPayload {
  status: 'ok' | 'degraded';
  database: DependencyStatus;
  storage: DependencyStatus;
  uptime: number;
}

// The Supabase client (apps/api/src/infrastructure/supabase/supabase.provider.ts)
// sets no `db.timeout`, so a probe's underlying fetch has no bound of its own —
// a reachable-but-slow dependency would otherwise hang this route indefinitely.
// Bounding each probe keeps /health fast and 2xx even when a dependency stalls,
// which is the whole point of it being a liveness check.
const PROBE_TIMEOUT_MS = 3000;

@ApiTags('Health')
@Controller({ version: '' })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  // Render's `healthCheckPath` (render.yaml) points at this route. It must
  // always return 2xx — a degraded 503 here would make Render treat the
  // instance as unhealthy and can trigger a rollback, which is a deliberate
  // dashboard-side decision this endpoint must not make unilaterally.
  @Get('health')
  @ApiOperation({
    summary: 'Liveness check (always 2xx while the process is up)',
  })
  async check(): Promise<HealthPayload> {
    return this.buildPayload();
  }

  // Strict readiness: the deploy smoke checks (deploy-api.yml, deploy-production.yml)
  // hit this path instead of /health so a degraded dependency actually fails the gate.
  //
  // The global AllExceptionsFilter flattens every HttpException response to
  // {statusCode, error, message, requestId} and drops any other key (#1020
  // tracks exposing structured fields; not settled here) — so the degraded
  // detail must travel in `message`, a plain string, the same convention
  // `ForbiddenException({ code, message })` already uses elsewhere in this API.
  @Get('health/ready')
  @ApiOperation({
    summary: 'Readiness check (503 when a dependency is degraded)',
  })
  async ready(): Promise<HealthPayload> {
    const payload = await this.buildPayload();

    if (payload.status === 'degraded') {
      throw new ServiceUnavailableException({
        code: 'DEGRADED',
        message: `database: ${payload.database}, storage: ${payload.storage}`,
      });
    }

    return payload;
  }

  private async buildPayload(): Promise<HealthPayload> {
    const [database, storage] = await Promise.all([
      this.probeDatabase(),
      this.probeStorage(),
    ]);

    return {
      status:
        database === 'connected' && storage === 'connected' ? 'ok' : 'degraded',
      database,
      storage,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
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
