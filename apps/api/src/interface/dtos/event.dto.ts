import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
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

  @ApiPropertyOptional({
    description:
      'For recurring events: this_instance (default), this_and_future, or entire_series',
    enum: ['this_instance', 'this_and_future', 'entire_series'],
  })
  @IsOptional()
  @IsIn(['this_instance', 'this_and_future', 'entire_series'])
  scope?: 'this_instance' | 'this_and_future' | 'entire_series';
}
