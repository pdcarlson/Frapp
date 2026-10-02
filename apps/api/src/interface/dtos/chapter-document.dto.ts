import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { POSITION_MAX } from '@repo/validation';
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
  @IsOptional()
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
  @MaxLength(255)
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
    description: 'Free-text document category (bylaws, budget, minutes, ...)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  document_type?: string;

  @ApiPropertyOptional({
    description:
      'Date this document took effect (ISO date), distinct from the upload timestamp',
  })
  @IsOptional()
  @IsDateString()
  effective_date?: string;
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
