import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { MAX_BACKWORK_ZIP_FILES, YEAR_MAX } from '@repo/validation';
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

export class ConfirmBackworkUploadDto {
  @ApiProperty({ description: 'Storage path returned from upload-url' })
  @IsString()
  storage_path: string;

  @ApiProperty({ description: 'SHA-256 hash of the uploaded file' })
  @IsString()
  file_hash: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({ description: 'Department code (e.g. "CS")' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  department_code?: string;

  @ApiPropertyOptional({ description: 'Course number (e.g. "101")' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  course_number?: string;

  @ApiPropertyOptional({ description: 'Professor name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  professor_name?: string;

  @ApiPropertyOptional({ maximum: YEAR_MAX })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(YEAR_MAX)
  year?: number;

  @ApiPropertyOptional({ enum: SEMESTERS })
  @IsOptional()
  @IsIn(SEMESTERS)
  semester?: string;

  @ApiPropertyOptional({ enum: ASSIGNMENT_TYPES })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  assignment_type?: string;

  @ApiPropertyOptional({ maximum: INT4_MAX })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  assignment_number?: number;

  @ApiPropertyOptional({ enum: DOCUMENT_VARIANTS })
  @IsOptional()
  @IsIn(DOCUMENT_VARIANTS)
  document_variant?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsStrictBoolean()
  is_redacted?: boolean;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ description: 'Full department name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
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
