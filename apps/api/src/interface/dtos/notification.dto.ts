import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'Expo push token' })
  @IsString()
  token: string;

  @ApiPropertyOptional({ description: 'Device name for display' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_name?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ description: 'Chapter ID' })
  @IsUUID()
  chapter_id: string;

  @ApiProperty({ description: 'Notification category (e.g. chat, events)' })
  @IsString()
  @MaxLength(100)
  category: string;

  @ApiProperty({
    description: 'Whether notifications for this category are enabled',
  })
  @IsBoolean()
  is_enabled: boolean;
}

export class UpdateUserSettingsDto {
  @ApiPropertyOptional({
    description: 'Quiet hours start (HH:mm format, e.g. 22:00)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, {
    message: 'quiet_hours_start must be in HH:mm or HH:mm:ss format',
  })
  quiet_hours_start?: string;

  @ApiPropertyOptional({
    description: 'Quiet hours end (HH:mm format, e.g. 08:00)',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, {
    message: 'quiet_hours_end must be in HH:mm or HH:mm:ss format',
  })
  quiet_hours_end?: string;

  @ApiPropertyOptional({
    description: 'Timezone for quiet hours (e.g. America/New_York)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  quiet_hours_tz?: string;

  @ApiPropertyOptional({
    description: 'Theme preference',
    enum: ['light', 'dark', 'system'],
  })
  @IsOptional()
  @IsString()
  @Matches(/^(light|dark|system)$/, {
    message: 'theme must be light, dark, or system',
  })
  theme?: 'light' | 'dark' | 'system';
}
