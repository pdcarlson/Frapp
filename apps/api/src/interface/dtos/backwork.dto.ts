import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
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
const DOCUMENT_VARIANTS = [
  'Student Copy',
  'Blank Copy',
  'Answer Key',
] as const;

export class RequestUploadUrlDto {
  @ApiProperty({ description: 'Original filename' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. application/pdf)' })
  @IsString()
  content_type: string;
}

export class ConfirmUploadDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1900)
  year?: number;

  @ApiPropertyOptional({ enum: SEMESTERS })
  @IsOptional()
  @IsIn(SEMESTERS)
  semester?: string;

  @ApiPropertyOptional({ enum: ASSIGNMENT_TYPES })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  assignment_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
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
  @IsBoolean()
  is_redacted?: boolean;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ description: 'Full department name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
