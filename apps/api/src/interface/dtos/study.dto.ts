import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  POINTS_ADJUSTMENT_MAX,
  ZONE_OUTLINE_MAX_POINTS,
  ZONE_RADIUS_MAX_M,
  ZONE_RADIUS_MIN_M,
} from '@repo/validation';
import { INT4_MAX } from '#domain/constants/field-limits';

export class GeofenceCoordinateDto {
  @ApiProperty()
  @IsNumber()
  lat: number;

  @ApiProperty()
  @IsNumber()
  lng: number;
}

export class GeofenceCircleDto {
  @ApiProperty({ minimum: -90, maximum: 90 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiProperty({
    minimum: ZONE_RADIUS_MIN_M,
    maximum: ZONE_RADIUS_MAX_M,
    description: 'Radius in meters.',
  })
  @IsNumber()
  @Min(ZONE_RADIUS_MIN_M)
  @Max(ZONE_RADIUS_MAX_M)
  radius_m: number;
}

const SHAPE_DESCRIPTION =
  'Send exactly one of `circle` or `coordinates`. A circle is stored with the polygon the API derives from it; an outline clears any circle.';

export class CreateGeofenceDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({
    type: [GeofenceCoordinateDto],
    description: `An outline's corners. ${SHAPE_DESCRIPTION}`,
  })
  @ValidateIf((dto: CreateGeofenceDto) => dto.circle == null)
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(ZONE_OUTLINE_MAX_POINTS)
  @ValidateNested({ each: true })
  @Type(() => GeofenceCoordinateDto)
  coordinates?: GeofenceCoordinateDto[];

  @ApiPropertyOptional({
    type: GeofenceCircleDto,
    description: `A circle zone. ${SHAPE_DESCRIPTION}`,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeofenceCircleDto)
  circle?: GeofenceCircleDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsStrictBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ default: 30, maximum: INT4_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
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

  @ApiPropertyOptional({ default: 15, maximum: INT4_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  min_session_minutes?: number;

  @ApiPropertyOptional({
    default: 5,
    description:
      'Minutes a backgrounded session may stay paused before it auto-expires as PAUSED_EXPIRED.',
    maximum: INT4_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  pause_grace_minutes?: number;
}

export class UpdateGeofenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    type: [GeofenceCoordinateDto],
    description: `An outline's corners. ${SHAPE_DESCRIPTION}`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(ZONE_OUTLINE_MAX_POINTS)
  @ValidateNested({ each: true })
  @Type(() => GeofenceCoordinateDto)
  coordinates?: GeofenceCoordinateDto[];

  @ApiPropertyOptional({
    type: GeofenceCircleDto,
    description: `A circle zone. ${SHAPE_DESCRIPTION}`,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeofenceCircleDto)
  circle?: GeofenceCircleDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsStrictBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ maximum: INT4_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
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

  @ApiPropertyOptional({ maximum: INT4_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(INT4_MAX)
  min_session_minutes?: number;

  @ApiPropertyOptional({
    description:
      'Minutes a backgrounded session may stay paused before it auto-expires as PAUSED_EXPIRED.',
    maximum: INT4_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
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
