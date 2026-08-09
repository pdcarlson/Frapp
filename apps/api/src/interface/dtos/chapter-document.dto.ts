import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestDocumentUploadUrlDto {
  @ApiProperty({ description: 'Original filename' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. application/pdf)' })
  @IsString()
  content_type: string;
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
}

export class CreateDocumentFolderDto {
  @ApiProperty({ description: 'Folder name (unique within the chapter)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description: 'Display position. Defaults to the end of the list.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
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

  @ApiPropertyOptional({ description: 'New display position' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}
