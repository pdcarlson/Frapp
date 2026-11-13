import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { POSITION_MAX } from '#domain/constants/field-limits';
import {
  DOCUMENT_TITLE_MAX_LENGTH,
  DOCUMENT_TYPE_NAME_MAX_LENGTH,
} from '@repo/validation';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestDocumentUploadUrlDto {
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

export class DocumentUploadUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived signed URL; PUT the bytes to it.',
  })
  upload_url: string;

  @ApiProperty({
    description: 'Storage path to send on the confirm-upload call.',
  })
  storage_path: string;

  @ApiProperty({
    description: 'Server-allocated document id embedded in storage_path.',
  })
  document_id: string;
}

export class ConfirmDocumentUploadDto {
  @ApiProperty({ description: 'Storage path returned from upload-url' })
  @IsString()
  storage_path: string;

  @ApiProperty({ description: 'Document title' })
  @IsString()
  @MaxLength(DOCUMENT_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional({ description: 'Document description' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Folder name (one level, flat structure)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  folder?: string;

  @ApiPropertyOptional({
    description: 'MIME content type, as declared for the upload',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  content_type?: string;

  @ApiPropertyOptional({ description: 'File size in bytes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  byte_size?: number;

  @ApiPropertyOptional({
    description:
      "One of the chapter's document types, matched ignoring case and stored in the list's spelling. A name the chapter doesn't have yet is added to its list.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(DOCUMENT_TYPE_NAME_MAX_LENGTH)
  document_type?: string;

  @ApiPropertyOptional({
    description:
      'Date this document took effect (ISO date), distinct from the upload timestamp',
  })
  @IsOptional()
  @IsDateString()
  effective_date?: string;
}

/**
 * Files one batch call takes: a folder import (#2242) mints its upload links
 * and files its documents 25 at a time, so the fan-out throttle (10 calls a
 * minute) still lets it move 250 files a minute.
 */
export const DOCUMENT_BATCH_MAX = 25;

export class RequestDocumentUploadUrlsDto {
  @ApiProperty({
    type: [RequestDocumentUploadUrlDto],
    description: `One to ${DOCUMENT_BATCH_MAX} files, each checked as the single upload-url route checks it`,
    maxItems: DOCUMENT_BATCH_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => RequestDocumentUploadUrlDto)
  files: RequestDocumentUploadUrlDto[];
}

export class DocumentUploadUrlsResponseDto {
  @ApiProperty({
    type: [DocumentUploadUrlResponseDto],
    description: 'One ticket per file, in the order sent',
  })
  tickets: DocumentUploadUrlResponseDto[];
}

export class ConfirmDocumentUploadsDto {
  @ApiProperty({
    type: [ConfirmDocumentUploadDto],
    description: `One to ${DOCUMENT_BATCH_MAX} uploads to file, each as the single confirm route takes it`,
    maxItems: DOCUMENT_BATCH_MAX,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DOCUMENT_BATCH_MAX)
  @ValidateNested({ each: true })
  @Type(() => ConfirmDocumentUploadDto)
  documents: ConfirmDocumentUploadDto[];
}

export class CreateDocumentFolderDto {
  @ApiProperty({ description: 'Folder name (unique within the chapter)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Display position. Defaults to the end of the list.',
    maximum: POSITION_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  sort_order?: number;
}

export class UpdateDocumentFolderDto {
  @ApiPropertyOptional({
    description:
      'New folder name. Renaming re-files every document in the folder.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'New display position',
    maximum: POSITION_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  sort_order?: number;
}

export class CreateDocumentTypeDto {
  @ApiProperty({
    description: 'Type name (unique within the chapter, ignoring case)',
    maxLength: DOCUMENT_TYPE_NAME_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(DOCUMENT_TYPE_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    description: 'Display position. Defaults to the end of the list.',
    maximum: POSITION_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  sort_order?: number;
}

export class UpdateDocumentTypeDto {
  @ApiPropertyOptional({
    description:
      'New type name. Renaming renames the type on every document of that type.',
    maxLength: DOCUMENT_TYPE_NAME_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(DOCUMENT_TYPE_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description: 'New display position',
    maximum: POSITION_MAX,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  sort_order?: number;
}

/** A document type as the type routes return it (#3642). */
export class DocumentTypeDto {
  @ApiProperty() id: string;
  @ApiProperty() chapter_id: string;
  @ApiProperty() name: string;
  @ApiProperty() sort_order: number;
  @ApiProperty() created_at: string;
}

/** The caller's own starred folders and documents (#3934). */
export class DocumentStarsDto {
  @ApiProperty({
    type: [String],
    description: 'Ids of the folders the caller starred, oldest star first',
  })
  folder_ids: string[];

  @ApiProperty({
    type: [String],
    description: 'Ids of the documents the caller starred, oldest star first',
  })
  document_ids: string[];
}

/**
 * A document row as the list and pin routes return it. Declared so the SDK
 * types `pinned_at` (#3934) rather than leaving the body untyped.
 */
export class ChapterDocumentDto {
  @ApiProperty() id: string;
  @ApiProperty() chapter_id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, nullable: true }) folder: string | null;
  @ApiProperty() storage_path: string;
  @ApiProperty() uploaded_by: string;
  @ApiProperty() created_at: string;
  @ApiProperty({ type: String, nullable: true }) content_type: string | null;
  @ApiProperty({ type: Number, nullable: true }) byte_size: number | null;
  @ApiProperty({ type: String, nullable: true }) document_type: string | null;
  @ApiProperty({ type: String, nullable: true }) effective_date: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When an officer pinned it for the whole chapter, or null',
  })
  pinned_at: string | null;
}

/** A folder as the folder list and pin routes return it (#3934). */
export class DocumentFolderDto {
  @ApiProperty() id: string;
  @ApiProperty() chapter_id: string;
  @ApiProperty() name: string;
  @ApiProperty() sort_order: number;
  @ApiProperty() created_at: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'When an officer pinned it for the whole chapter, or null',
  })
  pinned_at: string | null;
}

/** One grid preview link (#4647): the document and its inline signed URL. */
export class DocumentPreviewUrlDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Inline signed URL, valid for an hour' })
  url: string;
}

export class DocumentConfirmResultDto {
  @ApiProperty({ description: 'The storage path this result is for' })
  storage_path: string;

  @ApiPropertyOptional({
    type: ChapterDocumentDto,
    description: 'The filed document, when it was filed',
  })
  document?: ChapterDocumentDto;

  @ApiPropertyOptional({
    description: 'Why it was not filed, when it was not',
  })
  error?: string;
}

export class DocumentConfirmResultsDto {
  @ApiProperty({
    type: [DocumentConfirmResultDto],
    description: 'One result per upload, in the order sent',
  })
  results: DocumentConfirmResultDto[];
}
