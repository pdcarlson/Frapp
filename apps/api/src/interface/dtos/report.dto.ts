import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  POINTS_WINDOWS,
  type PointsWindow,
} from '../../domain/utils/points-window';

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
  @ApiPropertyOptional({
    description: 'Filter by user ID (omit for chapter-wide)',
  })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({
    description:
      'Time window for totals (defaults to all-time). Defined identically to the points leaderboard: semester excludes the latest archive period; month is the trailing calendar month.',
    enum: [...POINTS_WINDOWS],
  })
  @IsOptional()
  @IsEnum(POINTS_WINDOWS)
  window?: PointsWindow;
}

export class ServiceReportDto {
  @ApiPropertyOptional({
    description: 'Filter by user ID (omit for chapter-wide)',
  })
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
