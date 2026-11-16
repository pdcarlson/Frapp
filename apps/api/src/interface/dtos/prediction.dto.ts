import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POINTS_ADJUSTMENT_MAX } from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import {
  PREDICTION_ANSWERS_MAX,
  PREDICTION_ANSWERS_MIN,
} from '../../application/services/prediction.service';

/** A calendar date and time with a zone: what `Date` parses on every runtime. */
const DATE_TIME_FORMAT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_TIME_MESSAGE =
  'must be a date and time with a time zone, such as 2026-11-20T18:00:00Z';

const PREDICTION_QUESTION_MAX_LENGTH = 200;
const PREDICTION_RULE_MAX_LENGTH = 1000;
const PREDICTION_ANSWER_MAX_LENGTH = 80;
const PREDICTION_NOTE_MAX_LENGTH = 500;

const PREDICTION_LIST_FILTERS = ['open', 'mine', 'settled', 'all'] as const;
export type PredictionListFilter = (typeof PREDICTION_LIST_FILTERS)[number];

export class CreatePredictionDto {
  @ApiProperty({ format: 'uuid', description: 'The channel its card goes in' })
  @IsUUID()
  channel_id: string;

  @ApiProperty({ maxLength: PREDICTION_QUESTION_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(PREDICTION_QUESTION_MAX_LENGTH)
  question: string;

  @ApiProperty({
    maxLength: PREDICTION_RULE_MAX_LENGTH,
    description: 'How the answer will be decided, shown on the card',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(PREDICTION_RULE_MAX_LENGTH)
  settle_rule: string;

  @ApiProperty({
    type: [String],
    description: `Answers (${PREDICTION_ANSWERS_MIN}-${PREDICTION_ANSWERS_MAX}), in order`,
    example: ['Yes', 'No'],
  })
  @IsArray()
  @ArrayMinSize(PREDICTION_ANSWERS_MIN)
  @ArrayMaxSize(PREDICTION_ANSWERS_MAX)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(PREDICTION_ANSWER_MAX_LENGTH, { each: true })
  answers: string[];

  @ApiProperty({ description: 'When staking stops (ISO 8601 with a zone)' })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(DATE_TIME_FORMAT, { message: `closes_at ${DATE_TIME_MESSAGE}` })
  closes_at: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Who settles it; the creator when omitted',
  })
  @IsOptional()
  @IsUUID()
  settler_id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'A member the question is about; it waits for their OK before it opens',
  })
  @IsOptional()
  @IsUUID()
  named_member_id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Replay key: a retry with the same key returns the same question',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

export class PlacePredictionStakeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  answer_id: string;

  @ApiProperty({ minimum: 1, maximum: POINTS_ADJUSTMENT_MAX })
  @IsInt()
  @Min(1)
  @Max(POINTS_ADJUSTMENT_MAX)
  amount: number;

  @ApiProperty({
    format: 'uuid',
    description:
      'Replay key: a retry with the same key places nothing more and returns the same result',
  })
  @IsUUID()
  client_message_id: string;
}

export class PredictionConsentDto {
  @ApiProperty({ description: 'true opens the question; false withdraws it' })
  @IsStrictBoolean()
  agree: boolean;
}

export class SettlePredictionDto {
  @ApiProperty({ format: 'uuid', description: 'The answer that won' })
  @IsUUID()
  answer_id: string;

  @ApiPropertyOptional({ maxLength: PREDICTION_NOTE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PREDICTION_NOTE_MAX_LENGTH)
  note?: string;

  @ApiPropertyOptional({
    description:
      'When the answer became known, if before now; stakes after it are refunded',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(DATE_TIME_FORMAT, { message: `known_at ${DATE_TIME_MESSAGE}` })
  known_at?: string;
}

export class QuestionPredictionDto {
  @ApiProperty({ maxLength: PREDICTION_NOTE_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(PREDICTION_NOTE_MAX_LENGTH)
  note: string;
}

export class ConfirmPredictionDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Settle on this answer instead; omitted confirms the result as settled',
  })
  @IsOptional()
  @IsUUID()
  answer_id?: string;
}

export class ListPredictionsQueryDto {
  @ApiPropertyOptional({ enum: PREDICTION_LIST_FILTERS, default: 'open' })
  @IsOptional()
  @IsIn(PREDICTION_LIST_FILTERS)
  filter?: PredictionListFilter;
}

// ── responses ─────────────────────────────────────────────────────────────

export class PredictionMarketDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) chapter_id: string;
  @ApiProperty({ format: 'uuid' }) channel_id: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  message_id: string | null;
  @ApiProperty({ format: 'uuid' }) created_by: string;
  @ApiProperty({ format: 'uuid' }) settler_id: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  named_member_id: string | null;
  @ApiProperty() question: string;
  @ApiProperty() settle_rule: string;
  @ApiProperty() closes_at: string;
  @ApiProperty({
    enum: [
      'awaiting_consent',
      'open',
      'settled',
      'questioned',
      'paid',
      'voided',
    ],
  })
  status: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  winning_answer_id: string | null;
  @ApiProperty({ nullable: true, type: String }) known_at: string | null;
  @ApiProperty({ nullable: true, type: String }) settle_note: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  settled_by: string | null;
  @ApiProperty({ nullable: true, type: String }) settled_at: string | null;
  @ApiProperty({ nullable: true, type: String })
  question_window_ends_at: string | null;
  @ApiProperty() payout_round: number;
  @ApiProperty({ nullable: true, type: String }) paid_at: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  voided_by: string | null;
  @ApiProperty({ nullable: true, type: String }) voided_at: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String })
  client_message_id: string | null;
  @ApiProperty() created_at: string;
  @ApiProperty() updated_at: string;
}

export class PredictionAnswerViewDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() label: string;
  @ApiProperty({ description: 'Points staked on this answer' }) pool: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Whole-percent share of all points staked; null before any',
  })
  chance: number | null;
}

export class PredictionStakerViewDto {
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiProperty({ format: 'uuid' }) answer_id: string;
  @ApiProperty() amount: number;
}

export class PredictionQuestionViewDto {
  @ApiProperty({ format: 'uuid' }) user_id: string;
  @ApiProperty() note: string;
  @ApiProperty() created_at: string;
}

export class PredictionMarketViewDto {
  @ApiProperty({ type: PredictionMarketDto }) market: PredictionMarketDto;
  @ApiProperty({ type: [PredictionAnswerViewDto] })
  answers: PredictionAnswerViewDto[];
  @ApiProperty() total_staked: number;
  @ApiProperty({ type: [PredictionStakerViewDto] })
  stakers: PredictionStakerViewDto[];
  @ApiProperty({ type: [PredictionStakerViewDto] })
  my_stakes: PredictionStakerViewDto[];
  @ApiProperty({
    nullable: true,
    type: String,
    description: "Why the viewer can't stake right now; null when they can",
  })
  stake_blocked_reason: string | null;
  @ApiProperty({
    type: [PredictionQuestionViewDto],
    description: 'Unresolved questions about the result',
  })
  open_questions: PredictionQuestionViewDto[];
}

export class PredictionConsentResultDto {
  @ApiProperty({
    type: PredictionMarketViewDto,
    nullable: true,
    description: 'The opened question, or null once a decline removed it',
  })
  prediction: PredictionMarketViewDto | null;
}
