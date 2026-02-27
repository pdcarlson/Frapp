import { IsOptional, IsString, IsInt, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestAvatarUploadUrlDto {
  @ApiProperty({ description: 'Original filename for the avatar image' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. image/jpeg, image/png)' })
  @IsString()
  content_type: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  graduation_year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  current_city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  current_company?: string;
}
