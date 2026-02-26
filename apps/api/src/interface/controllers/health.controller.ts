import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

@ApiTags('Health')
@Controller({ version: '' })
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  async check() {
    let dbStatus = 'disconnected';
    try {
      const { error } = await this.supabase
        .from('chapters')
        .select('id')
        .limit(1);
      dbStatus = error ? 'error' : 'connected';
    } catch {
      dbStatus = 'error';
    }

    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      database: dbStatus,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }
}
