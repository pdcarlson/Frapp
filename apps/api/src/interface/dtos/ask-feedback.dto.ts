import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ASK_FEEDBACK_RATINGS,
  ASK_FEEDBACK_REASONS,
  ASK_SIGNALS,
  type AskFeedbackRating,
  type AskFeedbackReason,
  type AskSignal,
} from '@repo/validation';
import type { AskFeedbackRow } from '#domain/entities/ask-trace.entity';

/** `PUT /v1/ai/ask/{ask_id}/feedback`: the asker's thumbs on an answer (#4902). */
export class SetAskFeedbackDto {
  @ApiProperty({ enum: ASK_FEEDBACK_RATINGS })
  @IsIn(ASK_FEEDBACK_RATINGS)
  rating: AskFeedbackRating;

  @ApiPropertyOptional({
    enum: ASK_FEEDBACK_REASONS,
    nullable: true,
    description:
      'With `down` only. A down can be sent first and sent again with its reason; each call replaces the one before.',
  })
  @IsOptional()
  @IsIn(ASK_FEEDBACK_REASONS)
  reason?: AskFeedbackReason | null;
}

export class AskFeedbackDto {
  @ApiProperty({ format: 'uuid' })
  ask_id: string;

  @ApiProperty({ enum: ASK_FEEDBACK_RATINGS })
  rating: string;

  @ApiProperty({ enum: ASK_FEEDBACK_REASONS, nullable: true })
  reason: string | null;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  static from(row: AskFeedbackRow): AskFeedbackDto {
    return {
      ask_id: row.ask_id,
      rating: row.rating,
      reason: row.reason,
      updated_at: row.updated_at,
    };
  }
}

/** `POST /v1/ai/ask/{ask_id}/signals`: a tap under an answer (#4902). */
export class AskSignalDto {
  @ApiProperty({
    enum: ASK_SIGNALS,
    description:
      'What the member did: `retried` (Try again), `think_harder`, `source_opened`, `card_confirmed` or `card_dismissed`.',
  })
  @IsIn(ASK_SIGNALS)
  signal: AskSignal;
}
