import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

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

/** Switch one or both filters. A filter left out keeps its stored value. */
export class UpdateChatSidebarDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  unread_only?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hide_muted?: boolean;
}
