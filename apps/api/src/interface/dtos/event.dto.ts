import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty()
  @IsISO8601()
  start_time: string;

  @ApiProperty()
  @IsISO8601()
  end_time: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  point_value?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Recurrence rule (e.g. WEEKLY, BIWEEKLY, MONTHLY)',
  })
  @IsOptional()
  @IsString()
  recurrence_rule?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_role_ids?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts an interactive event card to this chat channel after the event is created (the `/event` slash command). Omit for dashboard creates.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

export class UpdateEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  start_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  end_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  point_value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Recurrence rule (e.g. WEEKLY, BIWEEKLY, MONTHLY)',
  })
  @IsOptional()
  @IsString()
  recurrence_rule?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_role_ids?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
