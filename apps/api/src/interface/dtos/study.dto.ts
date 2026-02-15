import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartSessionDto {
  @ApiProperty({ example: 'geofence-uuid' })
  @IsString()
  @IsNotEmpty()
  geofenceId: string;

  @ApiProperty({ example: 37.7749 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: -122.4194 })
  @IsNumber()
  longitude: number;
}

export class HeartbeatDto {
  @ApiProperty({ example: 37.7749 })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: -122.4194 })
  @IsNumber()
  longitude: number;
}

export class CreateGeofenceDto {
  @ApiProperty({ example: 'Library' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: [
      { lat: 37.77, lng: -122.41 },
      { lat: 37.78, lng: -122.42 },
    ],
  })
  @IsNotEmpty()
  coordinates: { lat: number; lng: number }[];
}
