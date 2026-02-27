import { IsString, IsOptional, IsUrl, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LogoUploadUrlDto {
  @ApiProperty({ description: 'Original filename (e.g. logo.png)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. image/png)' })
  @IsString()
  content_type: string;
}

export class ConfirmLogoDto {
  @ApiProperty({ description: 'Storage path returned from logo-url' })
  @IsString()
  storage_path: string;
}

export class CreateChapterDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  university: string;
}

export class UpdateChapterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  university?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'accent_color must be a valid hex color',
  })
  accent_color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  donation_url?: string;
}
