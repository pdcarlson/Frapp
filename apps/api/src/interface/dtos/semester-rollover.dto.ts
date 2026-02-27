import { IsDateString, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
