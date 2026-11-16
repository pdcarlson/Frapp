import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  MAX_BACKWORK_DRAFT_BATCH,
  MAX_BACKWORK_ZIP_FILES,
  MAX_COURSE_NAME_LENGTH,
  MAX_COURSE_NICKNAMES,
  MAX_COURSE_NICKNAME_LENGTH,
  YEAR_MAX,
} from '@repo/validation';
import { INT4_MAX } from '#domain/constants/field-limits';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const SEMESTERS = ['Spring', 'Summer', 'Fall', 'Winter'] as const;
const ASSIGNMENT_TYPES = [
  'Exam',
  'Midterm',
  'Final Exam',
  'Quiz',
  'Homework',
  'Lab',
  'Project',
  'Study Guide',
  'Notes',
  'Other',
] as const;
const DOCUMENT_VARIANTS = ['Student Copy', 'Blank Copy', 'Answer Key'] as const;

export class RequestBackworkUploadUrlDto {
  @ApiProperty({ description: 'Original filename' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. application/pdf)' })
  @IsString()
  content_type: string;

  @ApiPropertyOptional({
    description:
      'File size in bytes, if known. Rejected server-side against the upload size ceiling when present.',
  })
  // Omitted is "size unknown"; `null` is not a size. `@IsOptional` would
  // let it through to the ceiling check, which then called it too large (#2913).
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  size_bytes?: number;
}

export class BackworkUploadUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived signed URL; PUT the bytes to it.',
  })
  upload_url: string;

  @ApiProperty({
    description: 'Storage path to send on the confirm-upload call.',
  })
  storage_path: string;

  @ApiProperty({
    description: 'Server-allocated resource id embedded in storage_path.',
  })
  resource_id: string;
}

/**
 * A document's metadata, shared by the confirm body and a draft edit (#5208).
 * Every field is optional. In a draft edit, a field sent as `null` clears it.
 */
export class BackworkFieldsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Department code (e.g. "CS")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  department_code?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Course number (e.g. "101")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  course_number?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The course\'s name ("Calculus I"). Saved only when the course has no name yet; an upload never renames a course.',
    maxLength: MAX_COURSE_NAME_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COURSE_NAME_LENGTH)
  course_name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Professor name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  professor_name?: string;

  @ApiPropertyOptional({ nullable: true, maximum: YEAR_MAX })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(YEAR_MAX)
  year?: number;

  @ApiPropertyOptional({ nullable: true, enum: SEMESTERS })
  @IsOptional()
  @IsIn(SEMESTERS)
  semester?: string;

  @ApiPropertyOptional({ nullable: true, enum: ASSIGNMENT_TYPES })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  assignment_type?: string;

  @ApiPropertyOptional({ nullable: true, maximum: INT4_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  assignment_number?: number;

  @ApiPropertyOptional({ nullable: true, enum: DOCUMENT_VARIANTS })
  @IsOptional()
  @IsIn(DOCUMENT_VARIANTS)
  document_variant?: string;

  @ApiPropertyOptional({ nullable: true, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class ConfirmBackworkUploadDto extends BackworkFieldsDto {
  @ApiProperty({ description: 'Storage path returned from upload-url' })
  @IsString()
  storage_path: string;

  @ApiProperty({ description: 'SHA-256 hash of the uploaded file' })
  @IsString()
  file_hash: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsStrictBoolean()
  is_redacted?: boolean;

  @ApiPropertyOptional({
    description:
      'Save as a draft: the fields are kept as sent, not filed, and only the uploader sees the file until it is published (POST /v1/backwork/drafts/publish).',
  })
  @IsOptional()
  @IsStrictBoolean()
  draft?: boolean;
}

/** Ids of the caller's own drafts, for an edit or a publish. */
class BackworkDraftIdsDto {
  @ApiProperty({
    type: [String],
    maxItems: MAX_BACKWORK_DRAFT_BATCH,
    description: "The caller's drafts. Other ids are left out.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BACKWORK_DRAFT_BATCH)
  @IsUUID(undefined, { each: true })
  ids: string[];
}

export class UpdateBackworkDraftsDto extends BackworkDraftIdsDto {
  @ApiProperty({
    type: BackworkFieldsDto,
    description:
      'Fields to set on every listed draft. Fields left out keep their value; a field sent as null clears it.',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => BackworkFieldsDto)
  fields: BackworkFieldsDto;
}

export class PublishBackworkDraftsDto extends BackworkDraftIdsDto {}

export class BackworkDraftFailureDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Why it stayed a draft, in words to show.' })
  message: string;
}

export class PublishBackworkDraftsResponseDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'The filed resources.',
  })
  published: object[];

  @ApiProperty({ type: [BackworkDraftFailureDto] })
  failed: BackworkDraftFailureDto[];
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ description: 'Full department name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class BackworkCourseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({ format: 'uuid' })
  department_id: string;

  @ApiProperty({ description: 'Course number as first saved, e.g. "1010"' })
  course_number: string;

  @ApiProperty({
    description:
      'The course number trimmed and lowercased; files join a course by department_id and this.',
  })
  course_key: string;

  @ApiProperty({ type: String, nullable: true, example: 'Calculus I' })
  name: string | null;

  @ApiProperty({ type: [String], example: ['Calc 1', 'Calc I'] })
  nicknames: string[];

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}

/**
 * A change to a course's name and nicknames, creating its entry on first
 * write. Nicknames travel as a change (remove, then add) that one SQL
 * statement applies to the row as it is when it runs, so an edit never drops a
 * nickname someone else saved and two first writes don't collide. Who
 * may change what is `courseEditRefusal` (domain/utils/backwork-course-rules).
 */
export class UpsertBackworkCourseDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  department_id: string;

  @ApiProperty({ description: 'Course number (e.g. "1010")', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  @Matches(/\S/, { message: 'course_number must not be blank' })
  course_number: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: MAX_COURSE_NAME_LENGTH,
    description:
      'Omit to keep the stored name. A blank or null clears it (backwork:admin).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COURSE_NAME_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_COURSE_NICKNAMES,
    description:
      'Nicknames to add to the list as stored. Open to backwork:upload; a list past the cap is a 400.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COURSE_NICKNAMES)
  @IsString({ each: true })
  @MaxLength(MAX_COURSE_NICKNAME_LENGTH, { each: true })
  add_nicknames?: string[];

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_COURSE_NICKNAMES,
    description:
      'Nicknames to remove from the list as stored, matched case-insensitively. Needs backwork:admin.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COURSE_NICKNAMES)
  @IsString({ each: true })
  @MaxLength(MAX_COURSE_NICKNAME_LENGTH, { each: true })
  remove_nicknames?: string[];
}

export class UpdateProfessorDto {
  @ApiPropertyOptional({ description: 'Professor name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class MergeBackworkTaxonomyDto {
  @ApiProperty({
    description: 'Id of the row to merge into; the source is deleted',
  })
  @IsUUID()
  target_id: string;
}

export class MergeBackworkTaxonomyResponseDto {
  @ApiProperty({
    description: 'Count of resources reassigned from source to target',
  })
  reassigned: number;
}

/**
 * One comma-separated value, or the key repeated: both arrive as a list.
 * Lowercased, because Postgres answers with lowercase ids and the service
 * matches them back by string, and de-duplicated, so 50 copies of one id
 * don't mint 50 links. A part that isn't a string passes through for
 * `@IsUUID` to refuse.
 */
function splitIdList(value: unknown): unknown[] {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  const ids = parts
    .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
    .map((part) =>
      typeof part === 'string' ? part.trim().toLowerCase() : part,
    )
    .filter((part) => part !== '');
  return [...new Set(ids)];
}

export class BackworkDownloadUrlsQueryDto {
  @ApiProperty({
    description: `Comma-separated resource ids to sign, at most ${MAX_BACKWORK_ZIP_FILES}`,
    type: String,
    example:
      '3f0c1d9e-0000-4000-8000-000000000001,3f0c1d9e-0000-4000-8000-000000000002',
  })
  @Transform(({ value }: { value: unknown }) => splitIdList(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BACKWORK_ZIP_FILES)
  @IsUUID(undefined, { each: true })
  ids: string[];
}

export class BackworkDownloadUrlDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'Short-lived signed URL that downloads the file',
  })
  download_url: string;
}

export class BackworkDownloadUrlsResponseDto {
  @ApiProperty({
    type: [BackworkDownloadUrlDto],
    description:
      'In the order asked. An id not in this chapter, or that could not be signed, is left out.',
  })
  files: BackworkDownloadUrlDto[];
}

export class BackworkDraftFillResponseDto {
  @ApiProperty({
    enum: [
      'filled',
      'nothing_found',
      'unreadable',
      'not_redacted',
      'refused',
      'unavailable',
      'invalid_output',
    ],
    description:
      '`filled`: fields were set. `nothing_found`: the file was read and nothing new could be told. `unreadable`: too little text to read (likely a scan) or too large to open. The rest leave the draft unchanged: `not_redacted` (uploaded as-is, so its file is never read), `refused` (the provider declined), `unavailable` (a spend cap, `reason` says which), `invalid_output` (try again).',
  })
  status: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'The fields this fill set. Absent when the draft is unchanged.',
  })
  filled?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'The draft as it now stands. `draft_fields.ai_filled` lists the fields an AI fill set that nobody has edited since.',
  })
  draft?: object;

  @ApiPropertyOptional()
  reason?: string;
}
