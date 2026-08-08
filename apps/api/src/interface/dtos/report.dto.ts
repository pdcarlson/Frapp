import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Envelope returned when `format=pdf`. The PDF itself is never streamed
 * inline — it lands in a private bucket and the caller gets a time-limited
 * signed URL (spec/behavior/reports.md, "Export Flow").
 */
export class ReportExportResponseDto {
  @ApiProperty({ description: 'Signed download URL, valid for one hour' })
  url: string;

  @ApiProperty({ description: 'ISO timestamp at which the URL stops working' })
  expires_at: string;

  @ApiProperty({ description: 'URL lifetime in seconds', example: 3600 })
  expires_in: number;

  @ApiProperty({ description: 'Suggested download filename' })
  filename: string;

  @ApiProperty({ description: 'Bucket-relative object path' })
  storage_path: string;

  @ApiProperty({ description: 'Number of data rows in the document' })
  row_count: number;

  @ApiProperty({
    description:
      'True when the report hit the row ceiling, so the document is not a complete record of the chapter. row_count reports what was printed, not what matched.',
    example: false,
  })
  truncated: boolean;

  @ApiProperty({
    description: 'The row ceiling that "truncated" refers to',
    example: 5000,
  })
  row_limit: number;
}
