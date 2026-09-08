import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type HealthStatus = 'ok' | 'degraded';
export type DependencyStatus = 'connected' | 'error';

/**
 * Public liveness / readiness JSON. `/health` always 2xx; `/health/ready`
 * returns this only on success (degraded throws 503).
 */
export class HealthPayloadDto {
  @ApiProperty({ enum: ['ok', 'degraded'] })
  status: HealthStatus;

  @ApiProperty({ enum: ['connected', 'error'] })
  database: DependencyStatus;

  @ApiProperty({ enum: ['connected', 'error'] })
  storage: DependencyStatus;

  @ApiProperty({ description: 'Process uptime in seconds' })
  uptime: number;

  @ApiPropertyOptional({
    description:
      'Deployed git SHA when Render set RENDER_GIT_COMMIT. Omitted when unset so local and CI do not invent a SHA.',
    example: '0ca478e9105105ff7013834615eee81499813d0e',
    pattern: '^[0-9a-fA-F]{7,40}$',
  })
  commit?: string;
}
