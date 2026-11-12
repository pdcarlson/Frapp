import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AI_REPORT_NOTE_MAX_LENGTH,
  AI_REPORT_REASONS,
  AI_REPORT_RECEIPT_MAX_LENGTH,
  AI_REPORT_RETENTION_DAYS,
  AI_REPORT_SUBJECTS,
  type AiReportReason,
  type AiReportSubject,
} from '@repo/validation';

/** `POST /v1/ai/reports`: a member reports something the AI made (#4315). */
export class CreateAiReportDto {
  @ApiProperty({
    enum: AI_REPORT_SUBJECTS,
    description:
      'What is reported: an Ask answer, the draft of a meeting’s minutes, a suggestion, or a channel summary.',
  })
  @IsIn(AI_REPORT_SUBJECTS)
  subject: AiReportSubject;

  @ApiProperty({
    format: 'uuid',
    description:
      'The ask’s id (from the stream’s `start` event), the meeting’s id (for its draft), the suggestion’s id, or the summary’s `summary_id`.',
  })
  @IsUUID()
  subject_id: string;

  @ApiProperty({ enum: AI_REPORT_REASONS })
  @IsIn(AI_REPORT_REASONS)
  reason: AiReportReason;

  @ApiPropertyOptional({
    maxLength: AI_REPORT_NOTE_MAX_LENGTH,
    description: 'The member’s own words, if they add any.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(AI_REPORT_NOTE_MAX_LENGTH)
  note?: string;

  @ApiPropertyOptional({
    maxLength: AI_REPORT_RECEIPT_MAX_LENGTH,
    description:
      'An Ask answer or a channel summary: its `report_receipt`, exactly as the server sent it. Opaque to clients.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(AI_REPORT_RECEIPT_MAX_LENGTH)
  receipt?: string;
}

export class AiReportOutcomeDto {
  @ApiProperty({
    description: 'This member had already reported this; nothing new was kept.',
  })
  already_reported: boolean;

  @ApiProperty({
    description:
      'Whether the text itself was kept, sealed, or only the reason and note.',
  })
  kept_text: boolean;

  @ApiProperty({
    format: 'date-time',
    description: 'When what was kept is deleted.',
  })
  expires_at: string;
}

export class AiReportPolicyDto {
  @ApiProperty({
    description:
      'Whether a report made now keeps the text (the server holds a sealing key). When false, only the reason and note are kept, and the sheet must say so.',
  })
  keeps_text: boolean;

  @ApiProperty({
    description: 'How many days a report is kept.',
    example: AI_REPORT_RETENTION_DAYS,
  })
  retention_days: number;
}
