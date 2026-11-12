import { IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AiChapterSettingsView,
  AiConsentState,
} from '../../application/services/ai/ai-consent.service';

export class AiConsentSheetProviderDto {
  @ApiProperty({ enum: ['anthropic', 'google', 'assemblyai'] })
  key: 'anthropic' | 'google' | 'assemblyai';

  @ApiProperty({
    description: "The company's own name, shown as is.",
    example: 'Anthropic',
  })
  name: string;
}

export class AiConsentSheetDataKindDto {
  @ApiProperty({
    enum: [
      'questions',
      'chapter_records',
      'roster',
      'channel_messages',
      'meetings',
    ],
  })
  key:
    | 'questions'
    | 'chapter_records'
    | 'roster'
    | 'channel_messages'
    | 'meetings';

  @ApiProperty({
    description: 'What is sent, in words a client shows as is.',
    example: 'Questions you ask',
  })
  label: string;
}

export class AiConsentSheetDto {
  @ApiProperty({
    description:
      'The sheet version. Send it back with the answer; a new version asks everyone again.',
    example: 1,
  })
  version: number;

  @ApiProperty({
    type: AiConsentSheetProviderDto,
    isArray: true,
    description: 'Every provider member data is sent to.',
  })
  providers: AiConsentSheetProviderDto[];

  @ApiProperty({
    type: AiConsentSheetDataKindDto,
    isArray: true,
    description: 'Every kind of data that is sent.',
  })
  data: AiConsentSheetDataKindDto[];
}

export class AiConsentStateDto implements AiConsentState {
  @ApiProperty({ type: AiConsentSheetDto })
  sheet: AiConsentState['sheet'];

  @ApiProperty({
    enum: ['yes', 'no'],
    nullable: true,
    description:
      'The answer on the current version. Null when not answered, which counts as No.',
  })
  answer: 'yes' | 'no' | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  answered_at: string | null;

  @ApiProperty({
    description:
      'True when the caller answered an earlier version but not this one, so the sheet changed since.',
  })
  sheet_changed: boolean;
}

export class AnswerAiConsentDto {
  @ApiProperty({
    description:
      'The version of the sheet the member was shown. 409 `ai.consent.stale_sheet` when it is no longer current.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  // Far above any version the sheet will reach; a bound so a client can't
  // send an arbitrary integer through to the comparison.
  @Max(10_000)
  sheet_version: number;

  @ApiProperty({ enum: ['yes', 'no'] })
  @IsIn(['yes', 'no'])
  answer: 'yes' | 'no';
}

export class AiChapterSettingsDto implements AiChapterSettingsView {
  @ApiProperty({ description: 'Ask Frapp is on for the chapter.' })
  ask: boolean;

  @ApiProperty({
    description: 'Drafting minutes, and tasks suggested from them, is on.',
  })
  meeting_notes: boolean;

  @ApiProperty({
    description:
      'Messages in chapter channels, from members who said yes, are a source.',
  })
  chat_source: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When a switch last changed. Null when none ever has.',
  })
  updated_at: string | null;

  @ApiProperty({
    description:
      "Whether the caller may change the switches: they hold the chapter's President role. A hint for drawing the page; PATCH checks again.",
  })
  can_change: boolean;
}

export class UpdateAiChapterSettingsDto {
  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsStrictBoolean()
  ask?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsStrictBoolean()
  meeting_notes?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_object, value) => value !== undefined)
  @IsStrictBoolean()
  chat_source?: boolean;
}
