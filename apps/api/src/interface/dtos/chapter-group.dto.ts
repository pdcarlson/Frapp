import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAPTER_GROUP_KINDS,
  GROUP_MEMBERS_MAX,
  GROUP_NAME_MAX_LENGTH,
} from '@repo/validation';
import {
  IsRoleColor,
  ROLE_COLOR_API_DESCRIPTION,
} from '../decorators/is-role-color.decorator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

/** One of a chapter's groups (`GET /v1/groups`, #4076). */
export class ChapterGroupDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({
    enum: CHAPTER_GROUP_KINDS,
    description:
      '`manual`: an officer picks its members. `pledge_class`, `class_year` and `major`: Frapp keeps one per pledge class, per graduation year and per major (matched ignoring case and spacing), and its members follow the members’ own data; only its color and ping switch can change. A `class_year` or `major` group can’t go on a channel list or be what a task is from: members set their own.',
  })
  kind: string;

  @ApiProperty({
    description:
      "The group's name, which `@` mentions it. An automatic group's is its pledge class's, \"Class of\" and the year, or the major as most of its members write it.",
  })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'One of the role palette colors, or null.',
  })
  color: string | null;

  @ApiProperty({
    description:
      'Whether any member may `@` the group. While false, only a member holding `channels:manage` or `roles:manage` can ping it.',
  })
  mentionable: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The pledge class a `pledge_class` group follows.',
  })
  pledge_class_id: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The graduation year a `class_year` group follows.',
  })
  class_year: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The major a `major` group follows, folded: trimmed, spacing collapsed, lower case.',
  })
  major_key: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'The `users.id` of every member in it now, any kind. An automatic group nobody is in has none, and is left out of pickers.',
  })
  member_ids: string[];

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

export class CreateChapterGroupDto {
  @ApiProperty({
    maxLength: GROUP_NAME_MAX_LENGTH,
    description:
      'The name, as the chapter writes it ("Third floor", "Live-ins"). Stored trimmed. No other role, tier or group of the chapter may be called the same, ignoring case and punctuation, and it may not read as @everyone or @here.',
  })
  @IsString()
  @MaxLength(GROUP_NAME_MAX_LENGTH)
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: ROLE_COLOR_API_DESCRIPTION,
  })
  @IsOptional()
  @IsRoleColor()
  color?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether any member may `@` it. Defaults to true.',
  })
  @IsOptional()
  @IsStrictBoolean()
  mentionable?: boolean;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: GROUP_MEMBERS_MAX,
    description:
      'Its first members, as `users.id`s of members of the chapter. Defaults to none.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GROUP_MEMBERS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  member_ids?: string[];
}

export class UpdateChapterGroupDto {
  @ApiPropertyOptional({
    maxLength: GROUP_NAME_MAX_LENGTH,
    description:
      "A manual group's new name, under the same rules as a new one. An automatic group's name follows its class, year or major and is refused here.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(GROUP_NAME_MAX_LENGTH)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: ROLE_COLOR_API_DESCRIPTION,
  })
  @IsOptional()
  @IsRoleColor()
  color?: string | null;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'Whether any member may `@` it.',
  })
  @IsOptional()
  @IsStrictBoolean()
  mentionable?: boolean;
}

export class SetChapterGroupMembersDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: GROUP_MEMBERS_MAX,
    description:
      "The group's whole member list, as `users.id`s of members of the chapter. Replaces the list, all or none.",
  })
  @IsArray()
  @ArrayMaxSize(GROUP_MEMBERS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  member_ids: string[];
}
