import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { EventAttendanceStatus } from '../../domain/entities/event-attendance.entity';

export class CheckInDto {
  // Intentionally empty for now; path params and auth provide context.
}

export class UpdateAttendanceDto {
  @ApiProperty({ enum: ['PRESENT', 'EXCUSED', 'ABSENT', 'LATE'] })
  @IsEnum(['PRESENT', 'EXCUSED', 'ABSENT', 'LATE'])
  status: EventAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excuse_reason?: string;
}
