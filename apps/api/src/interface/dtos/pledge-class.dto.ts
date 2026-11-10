import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  MEMBER_ORDER_NUMBER_MAX,
  PLEDGE_CLASS_ASSIGNMENTS_MAX,
  PLEDGE_CLASS_NAME_MAX_LENGTH,
  PLEDGE_CLASSES_MAX,
} from '@repo/validation';

export class PledgeClassDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    description:
      "The class's place in the chapter's list, lowest first, which is oldest first.",
  })
  position: number;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

/** Shared by create and rename, so the two can't accept different names. */
export class PledgeClassNameDto {
  @ApiProperty({
    maxLength: PLEDGE_CLASS_NAME_MAX_LENGTH,
    description:
      'The class name as the chapter writes it ("Alpha", "Fall 2019"). Stored trimmed; unique within the chapter, ignoring case.',
  })
  @IsString()
  @MaxLength(PLEDGE_CLASS_NAME_MAX_LENGTH)
  // At least one non-whitespace character: the column's CHECK measures the
  // trimmed name, and a blank one would otherwise surface as a 500.
  @Matches(/\S/, { message: 'name must not be blank' })
  name: string;
}

export class ReorderPledgeClassesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: PLEDGE_CLASSES_MAX,
    description:
      "Every one of the chapter's class ids, oldest class first. A list that is not exactly the chapter's current classes is refused with 409, so a stale editor can't drop a class out of order.",
  })
  @IsArray()
  @ArrayMaxSize(PLEDGE_CLASSES_MAX)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  ids: string[];
}

export class PledgeClassAssignmentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The membership id (members.id).',
  })
  @IsUUID()
  member_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: "One of the chapter's pledge classes, or null for none.",
  })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  pledge_class_id: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: MEMBER_ORDER_NUMBER_MAX,
    description:
      "The member's order within their class, or chapter-wide (a roll or bond number), or null for none. Not required to be unique.",
  })
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MEMBER_ORDER_NUMBER_MAX)
  order_number: number | null;
}

export class AssignPledgeClassesDto {
  @ApiProperty({
    type: [PledgeClassAssignmentDto],
    maxItems: PLEDGE_CLASS_ASSIGNMENTS_MAX,
    description:
      'Each listed member gets both values; members not listed are untouched. All of them are written or none.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PLEDGE_CLASS_ASSIGNMENTS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PledgeClassAssignmentDto)
  assignments: PledgeClassAssignmentDto[];
}

/** One member's class and order number after a write. */
export class MemberPledgeClassDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The membership id (members.id).',
  })
  member_id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  pledge_class_id: string | null;

  @ApiProperty({ type: Number, nullable: true })
  order_number: number | null;
}
