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
  async check() {
    const { database, storage } = await this.probeDependencies();

    return {
      status:
        database === 'connected' && storage === 'connected' ? 'ok' : 'degraded',
      database,
      storage,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  // Strict readiness: the deploy smoke checks (deploy-api.yml, deploy-production.yml)
  // hit this path instead of /health so a degraded dependency actually fails the gate.
  @Get('health/ready')
  @ApiOperation({
    summary: 'Readiness check (503 when a dependency is degraded)',
  })
  async ready() {
    const { database, storage } = await this.probeDependencies();
    const status =
      database === 'connected' && storage === 'connected' ? 'ok' : 'degraded';

    if (status === 'degraded') {
      throw new ServiceUnavailableException({
        status,
        database,
        storage,
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      });
    }

    return {
      status,
      database,
      storage,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  private async probeDependencies(): Promise<{
    database: DependencyStatus;
    storage: DependencyStatus;
  }> {
    const [database, storage] = await Promise.all([
      this.probeDatabase(),
      this.probeStorage(),
    ]);
    return { database, storage };
  }

  private async probeDatabase(): Promise<DependencyStatus> {
    try {
      const { error } = await this.supabase
        .from('chapters')
        .select('id')
        .limit(1);
      return error ? 'error' : 'connected';
    } catch {
      return 'error';
    }
  }

  private async probeStorage(): Promise<DependencyStatus> {
    try {
      const { error } = await this.supabase.storage.listBuckets();
      return error ? 'error' : 'connected';
    } catch {
      return 'error';
    }
  }
}
