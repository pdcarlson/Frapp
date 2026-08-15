import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POINTS_ADJUSTMENT_MAX } from '../../domain/constants/field-limits';

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
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
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

  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_session_minutes?: number;

  @ApiPropertyOptional({
    default: 5,
    description:
      'Minutes a backgrounded session may stay paused before it auto-expires as PAUSED_EXPIRED.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
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
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  min_session_minutes?: number;

  @ApiPropertyOptional({
    description:
      'Minutes a backgrounded session may stay paused before it auto-expires as PAUSED_EXPIRED.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
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
