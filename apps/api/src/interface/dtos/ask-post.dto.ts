import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AI_REPORT_RECEIPT_MAX_LENGTH } from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

/** `POST /v1/ai/ask/posts`: post an Ask Frapp answer to a channel (#4713). */
export class AskPostDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The channel to post in. The caller must be able to post there.',
  })
  @IsUUID()
  channel_id: string;

  @ApiProperty({
    maxLength: AI_REPORT_RECEIPT_MAX_LENGTH,
    description:
      'The answer’s `report_receipt`, exactly as the server sent it. Opaque to clients. What is posted is the answer inside it, never text from this request.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REPORT_RECEIPT_MAX_LENGTH)
  receipt: string;

  @ApiProperty({
    description:
      'False only asks what posting would warn about and writes nothing. True posts, when `acknowledged` names every warning.',
  })
  @IsStrictBoolean()
  confirm: boolean;

  @ApiPropertyOptional({
    type: [String],
    description:
      'The `key` of each warning the asker was shown and accepted. A post whose warnings are not all named here is not made, and the current list is returned.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  acknowledged?: string[];
}

export class AskPostRestrictedDto {
  @ApiProperty({
    description: 'Stable for the same source, for `acknowledged`.',
  })
  key: string;

  @ApiProperty({ description: 'The kind of source, as an answer names it.' })
  kind: string;

  @ApiProperty({
    description: 'The source’s name, or the records’ ("Your tasks").',
  })
  title: string;
}

export class AskPostOutcomeDto {
  @ApiProperty({ description: 'Whether the answer is now in the channel.' })
  posted: boolean;

  @ApiProperty({
    type: [AskPostRestrictedDto],
    description:
      'What the answer drew on that not everyone who can read the channel could open, as of this call.',
  })
  restricted: AskPostRestrictedDto[];
}
