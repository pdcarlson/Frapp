import {
  IsArray,
  IsBoolean,
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
}
