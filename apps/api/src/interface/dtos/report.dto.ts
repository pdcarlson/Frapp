import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AttendanceReportDto {
  @ApiPropertyOptional({ description: 'Filter by event ID' })
  @IsOptional()
  @IsUUID()
  event_id?: string;

  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  end_date?: string;
}

export class PointsReportDto {
  @ApiPropertyOptional({ description: 'Filter by user ID (omit for chapter-wide)' })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({ description: 'Time window (e.g. semester identifier)' })
  @IsOptional()
  @IsString()
  window?: string;
}

export class ServiceReportDto {
  @ApiPropertyOptional({ description: 'Filter by user ID (omit for chapter-wide)' })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({ description: 'Start date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  end_date?: string;
}
