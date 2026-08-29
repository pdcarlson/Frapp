import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RolloverDto {
  @ApiProperty({ description: 'Semester label (e.g. "Fall 2025")' })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiProperty({ description: 'Start date (ISO date)', example: '2025-08-01' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ description: 'End date (ISO date)', example: '2025-12-15' })
  @IsDateString()
  end_date: string;

  @ApiPropertyOptional({
    description:
      'Also bulk-promote every New Member in the chapter to Member, in the same transaction as the archive. Members keep all their other roles. Defaults to false.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  promote_new_members?: boolean;
}
