import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POINTS_ADJUSTMENT_MAX } from '../../domain/constants/field-limits';

export class CreateServiceEntryDto {
  @ApiProperty({ description: 'Date of service (YYYY-MM-DD)' })
  @IsString()
  date: string;

  @ApiProperty({
    description: 'Duration in minutes',
    minimum: 1,
    example: 60,
  })
  @IsInt()
  @Min(1)
  // Bounds the SERVICE ledger row, and does so provably: the award is
  // `floor(duration_minutes / minutesPerPoint)` and minutesPerPoint is @Min(1),
  // so the row can never exceed this number. Submitting a service entry needs
  // no special grant, which makes this the widest-open ledger input of all.
  // 100,000 minutes is ~69 days for a single entry — far beyond any real one.
  @Max(POINTS_ADJUSTMENT_MAX)
  duration_minutes: number;

  @ApiProperty({ description: 'Description of the service performed' })
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({
    description: 'Storage path to proof file (e.g. from upload)',
  })
  @IsOptional()
  @IsString()
  proof_path?: string;
}

export class RequestProofUploadUrlDto {
  @ApiProperty({ description: 'Original filename (image or PDF)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. application/pdf)' })
  @IsString()
  content_type: string;
}

/**
 * Filters for the admin service-entry queue. Every field is optional; the
 * unfiltered call is the previous behavior.
 *
 * Non-admins never reach these — the controller narrows their read to their
 * own entries before any filter is applied — so a member cannot use
 * `userId` to read someone else's history.
 */
export class ListServiceEntriesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by review status',
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
  })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Inclusive lower bound on the service date (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on the service date (YYYY-MM-DD)',
    example: '2026-05-31',
  })
  @IsOptional()
  @IsString()
  end_date?: string;

  @ApiPropertyOptional({
    description: 'Filter by member (admins with service:approve only)',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

/** Optional date window for the service leaderboard; omitted means all-time. */
export class ServiceLeaderboardQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive lower bound on the service date (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsString()
  start_date?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound on the service date (YYYY-MM-DD)',
    example: '2026-05-31',
  })
  @IsOptional()
  @IsString()
  end_date?: string;
}

export class ReviewServiceEntryDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Optional comment for the member (especially on rejection)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  review_comment?: string;
}
