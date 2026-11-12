import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Most rows one reorder may list. Far past any real chapter's channels in one
 * section or categories (a 112-role chapter imported from Discord has a few
 * dozen), and small enough that the RPC's `unnest` stays trivial.
 */
const REORDER_MAX_ITEMS = 500;

/**
 * `PUT /v1/channels/order`: one section of the channel list, in the order an
 * officer dragged it into.
 */
export class ReorderChannelsDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The category the channels are filed under, or null for the default Channels section. A channel listed from another section moves here.',
  })
  @IsOptional()
  @IsUUID()
  category_id: string | null;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: REORDER_MAX_ITEMS,
    description:
      'Every channel the officer sees in that section, top to bottom. Any other channel already in the section keeps its relative order after them. Never a DM, a group DM or #chapter-audit.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REORDER_MAX_ITEMS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  channel_ids: string[];
}

/** `PUT /v1/channels/categories/order`: the chapter's categories, top to bottom. */
export class ReorderCategoriesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: REORDER_MAX_ITEMS,
    description:
      'The chapter’s categories, top to bottom. A category not listed keeps its relative order after them.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REORDER_MAX_ITEMS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  category_ids: string[];
}

export class ReorderResponseDto {
  @ApiProperty()
  success: boolean;
}
