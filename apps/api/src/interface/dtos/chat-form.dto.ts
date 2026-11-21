import { IsObject } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';

const ANSWERS_SCHEMA: ApiPropertyOptions = {
  type: 'object',
  additionalProperties: {
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  },
};

/** A member's answers to a form card (#3926 step 3). */
export class SaveFormResponseDto {
  @ApiProperty({
    ...ANSWERS_SCHEMA,
    description:
      'Answers keyed by question id: text for a short-answer or paragraph question, the option id for multiple choice or a dropdown, a list of option ids for checkboxes, and `yes` or `no`. Leave a question out to leave it blank. 400 when a required question is blank, an answer does not fit its question, or the form is closed.',
  })
  @IsObject()
  answers: Record<string, string | string[]>;
}

/** The caller's own answers to a form card. */
export class FormResponseDto {
  @ApiProperty(ANSWERS_SCHEMA)
  answers: Record<string, string | string[]>;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

/** One member's answers, as the form's creator reads them (#3926 step 4). */
export class FormResponseEntryDto {
  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty(ANSWERS_SCHEMA)
  answers: Record<string, string | string[]>;

  @ApiProperty({
    format: 'date-time',
    description: 'When they first answered.',
  })
  created_at: string;

  @ApiProperty({
    format: 'date-time',
    description: 'When they last changed their answers.',
  })
  updated_at: string;
}

/** A form's responses, for its creator. */
export class FormResponsesDto {
  @ApiProperty({
    type: [FormResponseEntryDto],
    description:
      'Every saved response, first answered first. Names are joined from the roster; a member no longer on it has left.',
  })
  responses: FormResponseEntryDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    isArray: true,
    description:
      'Members who can read the form’s channel now and haven’t answered, the creator left out.',
  })
  not_responded: string[];
}

/** The caller's own answers, or `null` before they answer. */
export class OwnFormResponseDto {
  @ApiPropertyOptional({ type: FormResponseDto, nullable: true })
  response: FormResponseDto | null;
}
