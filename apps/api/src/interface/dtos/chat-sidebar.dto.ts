import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { SIDEBAR_SORTS, type SidebarSort } from '@repo/validation';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

/**
 * A member's own sidebar arrangement (#2877), as every `/v1/chat-sidebar`
 * route returns it. The rule is `spec/behavior/chat/README.md` § Sidebar
 * arrangement.
 */
export class ChatSidebarDto {
  @ApiProperty({
    description:
      'Show only channels with something unread, a mention included. Pinned channels and the open channel still show.',
  })
  unread_only: boolean;

  @ApiProperty({
    description:
      'Leave out channels whose notification level is off. A muted channel with an unread @-mention still shows.',
  })
  hide_muted: boolean;

  @ApiProperty({
    enum: SIDEBAR_SORTS,
    enumName: 'ChatSidebarSort',
    description:
      "How channels sort inside each section: chapter (the chapter's own order, then A to Z; the default), recent (newest latest message first) or alpha (A to Z by the name the row shows).",
  })
  sort: SidebarSort;

  @ApiProperty({
    type: [String],
    description:
      'Section keys the member folded: pinned, channels, direct, system, or category:<uuid>.',
  })
  collapsed_sections: string[];

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Channels the member pinned to the top, limited to channels they can still read. Carries no order: the sidebar sorts the Pinned section like any other.',
  })
  pinned_channel_ids: string[];
}

/** Only a key left out is optional: a `null` fails `@IsStrictBoolean()`. */
const whenSent = ValidateIf(
  (_dto: object, value: unknown) => value !== undefined,
);

/**
 * Switch a filter or the sort. A setting left out keeps its stored value.
 *
 * Each filter takes only a real boolean. `@IsOptional()` would let `null`
 * through to a `not null` column (a 500), and `@IsStrictBoolean()` stops
 * implicit conversion from saving the string `"false"` as `true`.
 */
export class UpdateChatSidebarDto {
  @ApiPropertyOptional()
  @whenSent
  @IsStrictBoolean()
  unread_only?: boolean;

  @ApiPropertyOptional()
  @whenSent
  @IsStrictBoolean()
  hide_muted?: boolean;

  @ApiPropertyOptional({ enum: SIDEBAR_SORTS, enumName: 'ChatSidebarSort' })
  @whenSent
  @IsIn(SIDEBAR_SORTS)
  sort?: SidebarSort;
}
