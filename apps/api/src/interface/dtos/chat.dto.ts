import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsArray,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChatChannelDto {
  @ApiProperty({ example: 'General' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Main chapter discussion', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE', 'ROLE_GATED'], default: 'PUBLIC' })
  @IsEnum(['PUBLIC', 'PRIVATE', 'ROLE_GATED'])
  type: 'PUBLIC' | 'PRIVATE' | 'ROLE_GATED' = 'PUBLIC';

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedRoleIds?: string[];
}

export class SendChatMessageDto {
  @ApiProperty({ example: 'Hello everyone!' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ required: false })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
