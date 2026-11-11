import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EVENT_TYPE_NAME_MAX_LENGTH,
  POINTS_ADJUSTMENT_MAX,
} from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import type { EventType } from '#domain/entities/event-type.entity';

export class EventTypeDto implements EventType {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    minimum: 0,
    maximum: POINTS_ADJUSTMENT_MAX,
    description:
      'Points for attending, copied onto an event made as this type.',
  })
  point_value: number;

  @ApiProperty({
    description:
      'Whether everyone must attend, copied onto an event made as this type.',
  })
  is_mandatory: boolean;

  @ApiProperty({
    description: "The type's place in the chapter's list, lowest first.",
  })
  position: number;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

export class CreateEventTypeDto {
  @ApiProperty({
    maxLength: EVENT_TYPE_NAME_MAX_LENGTH,
    description:
      'The type as the chapter calls it ("Chapter meeting", "Work party"). Stored trimmed; unique within the chapter, ignoring case.',
  })
  @IsString()
  @MaxLength(EVENT_TYPE_NAME_MAX_LENGTH)
  // At least one non-whitespace character: the column's CHECK measures the
  // trimmed name, and a blank one would otherwise surface as a 500.
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: POINTS_ADJUSTMENT_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  // Copied onto events, whose point_value carries the same ceiling.
  @Max(POINTS_ADJUSTMENT_MAX)
  point_value?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsStrictBoolean()
  is_mandatory?: boolean;
}

export class UpdateEventTypeDto {
  @ApiPropertyOptional({ maxLength: EVENT_TYPE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TYPE_NAME_MAX_LENGTH)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: POINTS_ADJUSTMENT_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POINTS_ADJUSTMENT_MAX)
  point_value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsStrictBoolean()
  is_mandatory?: boolean;
}
