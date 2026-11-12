import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASK_QUESTION_MAX_LENGTH } from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

export class AskRequestDto {
  @ApiProperty({
    description: 'The question, in the member’s own words.',
    example: 'What do the bylaws say about quorum?',
    maxLength: ASK_QUESTION_MAX_LENGTH,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
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
