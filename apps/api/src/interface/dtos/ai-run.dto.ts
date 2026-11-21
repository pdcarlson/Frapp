import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AI_RUN_FAILURE_REASONS,
  AI_RUN_STATUSES,
  type AiRunFailureReason,
  type AiRunRef,
  type AiRunStatus,
} from '#domain/entities/ai-run.entity';
import { AI_RUN_KIND } from '#domain/utils/ai-runs';
import type { AiRunView } from '../../application/services/ai-run.service';

export class AiRunIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id: string;
}

export class ListAiRunsQueryDto {
  @ApiPropertyOptional({
    description: 'Only runs of this kind (`minutes_draft`).',
    example: 'minutes_draft',
  })
  @IsOptional()
  @Matches(AI_RUN_KIND)
  kind?: string;

  @ApiPropertyOptional({
    description:
      'How many runs to return, newest first. 1 to 50; 20 when omitted.',
    minimum: 1,
    maximum: 50,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class AiRunDto implements AiRunView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'The run kind, `snake_case`.',
    example: 'minutes_draft',
  })
  kind: string;

  @ApiProperty({
    description:
      'What the run does, to show beside its status ("Drafting minutes"). The kind itself when this server has no handler for it.',
    example: 'Drafting minutes',
  })
  label: string;

  @ApiProperty({ enum: AI_RUN_STATUSES })
  status: AiRunStatus;

  @ApiProperty({
    description: 'Tries so far, the one in progress included.',
    minimum: 0,
  })
  attempt_count: number;

  @ApiProperty({ minimum: 1, maximum: 10 })
  max_attempts: number;

  @ApiProperty({ enum: AI_RUN_FAILURE_REASONS, nullable: true })
  failure_reason: AiRunFailureReason | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The failure in plain words, for the screen. Null unless `status` is `failed`.',
  })
  failure_message: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'What the run produced, by reference: ids and counts (`{ "draft_id": "…" }`). Never text. Null until it succeeds, and for kinds that produce nothing to point at.',
  })
  result_ref: AiRunRef | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  started_at: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finished_at: string | null;
}
