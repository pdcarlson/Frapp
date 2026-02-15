import {
  IsString,
  IsNotEmpty,
  IsDateString,
  IsNumber,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEventDto {
  @ApiProperty({ example: 'Chapter Meeting' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Weekly general assembly', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '2026-02-14T18:00:00Z' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2026-02-14T19:00:00Z' })
  @IsDateString()
  endTime: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  pointValue: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  isMandatory: boolean;
}
