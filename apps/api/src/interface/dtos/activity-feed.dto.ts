import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  ActivityFeedItem,
  ActivityFeedItemType,
  ActivityFeedActor,
} from '../../application/services/activity-feed.service';

export class ListActivityFeedQueryDto {
  @ApiPropertyOptional({
    description:
      'Max feed rows to return across all domains combined. Clamped to 1–50 inclusive; omitted defaults to 20.',
    minimum: 1,
    maximum: 50,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

const ACTIVITY_FEED_ITEM_TYPES: ActivityFeedItemType[] = [
  'event_created',
  'event_upcoming',
  'points_change',
  'backwork_upload',
  'member_joined',
  'announcement',
];

export class ActivityFeedActorDto implements ActivityFeedActor {
  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty({
    description:
      'Empty when the actor could not be resolved against the current roster (e.g. a member who has since left the chapter) — the server does not invent a placeholder name.',
  })
  display_name: string;

  @ApiProperty({ type: String, nullable: true })
  avatar_url: string | null;
}

export class ActivityFeedItemDto implements ActivityFeedItem {
  @ApiProperty({
    description: 'Stable within one response; not a database primary key.',
  })
  id: string;

  @ApiProperty({ enum: ACTIVITY_FEED_ITEM_TYPES })
  type: ActivityFeedItemType;

  @ApiProperty({
    format: 'date-time',
    description: 'Feed ordering key — newest first.',
  })
  timestamp: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, nullable: true })
  body: string | null;

  @ApiProperty({ type: ActivityFeedActorDto, nullable: true })
  actor: ActivityFeedActorDto | null;

  @ApiProperty({
    description:
      'The underlying record id (event, point transaction, backwork resource, joining member’s user id, or announcement channel id) for client-side navigation.',
  })
  target_id: string;
}
