import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ASK_HISTORY_ANSWER_MAX_LENGTH,
  ASK_HISTORY_MAX_TURNS,
  ASK_QUESTION_MAX_LENGTH,
} from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AskHistoryTurnDto {
  @ApiProperty({
    description: 'What the member typed in that turn.',
    maxLength: ASK_QUESTION_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ASK_QUESTION_MAX_LENGTH)
  question: string;

  @ApiProperty({
    description:
      'What Ask answered, or empty when the turn had no answer to carry (a proposal, nothing found, or an answer that drew on channel messages).',
    maxLength: ASK_HISTORY_ANSWER_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(ASK_HISTORY_ANSWER_MAX_LENGTH)
  answer: string;
}

export class AskRequestDto {
  @ApiProperty({
    description: 'The question, in the member’s own words.',
    example: 'What do the bylaws say about quorum?',
    maxLength: ASK_QUESTION_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ASK_QUESTION_MAX_LENGTH)
  question: string;

  @ApiPropertyOptional({
    description:
      'True when the client showed the "answers are being saved" line before sending. An exchange is kept by the beta diagnostics window only when this is true.',
  })
  @IsOptional()
  @IsStrictBoolean()
  saved_notice_shown?: boolean;

  @ApiPropertyOptional({
    type: [AskHistoryTurnDto],
    maxItems: ASK_HISTORY_MAX_TURNS,
    description:
      'The conversation before this question, oldest first, so a follow-up is understood. The server keeps nothing between questions; the client holds the conversation and sends it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ASK_HISTORY_MAX_TURNS)
  @ValidateNested({ each: true })
  @Type(() => AskHistoryTurnDto)
  history?: AskHistoryTurnDto[];

  @ApiPropertyOptional({
    description:
      'True when the client can show a proposal card. Then, for a caller who also holds `ai:act` and `members:view`, words that ask for something to be done end the stream with a `proposal` event in place of `done`. Nothing is changed by it: the card is confirmed with `POST /v1/ai/suggestions/{id}/accept`.',
  })
  @IsOptional()
  @IsStrictBoolean()
  actions?: boolean;
}

export class AskDiagnosticsDto {
  @ApiProperty({
    description:
      'Whether this chapter is the one the beta diagnostics window may be turned on for.',
  })
  offered: boolean;

  @ApiProperty({
    description:
      'Whether the caller may turn it on or off: the chapter’s president.',
  })
  can_change: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the open window ends, or null when nothing is being kept.',
  })
  ends_at: string | null;
}

export class AskStatusDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'While the beta diagnostics window is on for this chapter: questions and answers in Ask are kept until this time, and the client must say so before a question is sent. Null when nothing is kept.',
  })
  saved_until: string | null;

  @ApiProperty({ type: AskDiagnosticsDto })
  diagnostics: AskDiagnosticsDto;
}
