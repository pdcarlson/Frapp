import {
  IsArray,
  IsBooleanString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePollDto {
  @ApiProperty({ description: 'Poll question' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question: string;

  @ApiProperty({
    description: 'Poll options (2-10)',
    type: [String],
    example: ['Option A', 'Option B'],
  })
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  options: string[];

  @ApiPropertyOptional({
    description: 'Expiration time (ISO 8601)',
  })
  @IsOptional()
  @IsString()
  expires_at?: string;

  @ApiPropertyOptional({ enum: ['single', 'multi'], default: 'single' })
  @IsOptional()
  @IsIn(['single', 'multi'])
  choice_mode?: 'single' | 'multi';
}

export class VoteDto {
  @ApiProperty({
    description:
      'Option index(es) to vote for. Single choice: [0]. Multi choice: [0, 1].',
    type: [Number],
    example: [0],
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  option_indexes: number[];
}

export class ListPollsQueryDto {
  @ApiPropertyOptional({ description: 'Scope results to a single channel.' })
  @IsOptional()
  @IsString()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      "Accepts 'true' or 'false'. `true` returns only polls that haven't expired; `false` returns only expired polls.",
  })
  @IsOptional()
  @IsBooleanString()
  active?: 'true' | 'false';

  @ApiPropertyOptional({
    description: 'Max polls to return (1-200, defaults to 50).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
