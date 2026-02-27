import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  points_per_interval?: number;

  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  min_session_minutes?: number;
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
  points_per_interval?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  min_session_minutes?: number;
}

export class StartStudySessionDto {
  @ApiProperty()
  @IsString()
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
