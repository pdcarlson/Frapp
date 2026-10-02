import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POINTS_ADJUSTMENT_MAX,
  STUDY_ZONE_MINUTES_MAX,
} from '@repo/validation';

export class GeofenceCoordinateDto {
  @ApiProperty()
  @IsNumber()
  lat: number;

  @ApiProperty()
  @IsNumber()
  lng: number;
}

export class CreateGeofenceDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ type: [GeofenceCoordinateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeofenceCoordinateDto)
  coordinates: GeofenceCoordinateDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsStrictBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ default: 30, maximum: STUDY_ZONE_MINUTES_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(STUDY_ZONE_MINUTES_MAX)
  minutes_per_point?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  // Multiplied by the interval count into a point_transactions row, so it is a
  // ledger input. Capping the rate does not bound the product (a long enough
  // session still multiplies past the ceiling) — clamping the computed award is
  // #948; this closes the single-input case and the int4 overflow behind it.
  @Max(POINTS_ADJUSTMENT_MAX)
  points_per_interval?: number;

  @ApiPropertyOptional({ default: 15, maximum: STUDY_ZONE_MINUTES_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(STUDY_ZONE_MINUTES_MAX)
  min_session_minutes?: number;

  @ApiPropertyOptional({
    default: 5,
    description:
      'Minutes a backgrounded session may stay paused before it auto-expires as PAUSED_EXPIRED.',
    maximum: STUDY_ZONE_MINUTES_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(STUDY_ZONE_MINUTES_MAX)
  pause_grace_minutes?: number;
}

export class UpdateGeofenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [GeofenceCoordinateDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeofenceCoordinateDto)
  coordinates?: GeofenceCoordinateDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsStrictBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ maximum: STUDY_ZONE_MINUTES_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(STUDY_ZONE_MINUTES_MAX)
  minutes_per_point?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  // Multiplied by the interval count into a point_transactions row, so it is a
  // ledger input. Capping the rate does not bound the product (a long enough
  // session still multiplies past the ceiling) — clamping the computed award is
  // #948; this closes the single-input case and the int4 overflow behind it.
  @Max(POINTS_ADJUSTMENT_MAX)
  points_per_interval?: number;

  @ApiPropertyOptional({ maximum: STUDY_ZONE_MINUTES_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(STUDY_ZONE_MINUTES_MAX)
  min_session_minutes?: number;

  @ApiPropertyOptional({
    description:
      'Minutes a backgrounded session may stay paused before it auto-expires as PAUSED_EXPIRED.',
    maximum: STUDY_ZONE_MINUTES_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(STUDY_ZONE_MINUTES_MAX)
  pause_grace_minutes?: number;
}

export class StartStudySessionDto {
  // Reaches the geofence uuid PK filter; unvalidated it is a 500, not a 400.
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  geofence_id: string;

  @ApiProperty()
  @IsNumber()
  lat: number;

  @ApiProperty()
  @IsNumber()
  lng: number;
}

export class StudySessionHeartbeatDto {
  @ApiProperty()
  @IsNumber()
  lat: number;

  @ApiProperty()
  @IsNumber()
  lng: number;

  @ApiPropertyOptional({
    description:
      'GPS accuracy in meters for this fix, per the device location API. Optional so older clients that never send it keep working; omitting it skips the accuracy check entirely rather than rejecting the heartbeat.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy_meters?: number;
}

/**
 * Resume carries coordinates because the member may have left the study zone
 * while backgrounded, and the next heartbeat is up to five minutes out.
 */
export class ResumeStudySessionDto {
  @ApiProperty()
  @IsNumber()
  lat: number;

  @ApiProperty()
  @IsNumber()
  lng: number;
}
