import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// ── Asking for unposted minutes (#5471) ─────────────────────────────────────

export class MinutesRequestQueryDto {
  @ApiProperty({ format: 'uuid', description: 'The meeting’s event.' })
  @IsUUID()
  event_id: string;
}

export class MinutesRequestStateDto {
  @ApiProperty({ format: 'uuid' }) meeting_id: string;
  @ApiProperty({ format: 'uuid' }) event_id: string;
  @ApiProperty({ description: 'The caller has asked for these minutes.' })
  requested: boolean;
}
