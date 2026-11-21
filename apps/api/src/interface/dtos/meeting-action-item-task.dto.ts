import { ApiProperty } from '@nestjs/swagger';

/** A task for everyone's progress: copies done out of all of them. */
export class ActionItemTaskGroupDto {
  @ApiProperty({ minimum: 0 })
  done!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;
}

/**
 * Where an action item of posted minutes stands as a task, for the minutes'
 * checkbox. Only the done mark is told, never the task's fields: a member
 * may read the minutes without being able to read the task.
 */
export class MeetingActionItemTaskDto {
  @ApiProperty({
    minimum: 0,
    description: 'The action item’s place in the minutes’ list, from 0.',
  })
  index!: number;

  @ApiProperty({
    description:
      'Marked done: by its member, or by every copy of a task for everyone.',
  })
  done!: boolean;

  @ApiProperty({
    type: ActionItemTaskGroupDto,
    nullable: true,
    description: 'A task for everyone: how many of its copies are done.',
  })
  group!: ActionItemTaskGroupDto | null;
}

/** An action item still open, as the series screen lists it (#5482). */
export class OpenActionItemDto {
  @ApiProperty({
    minimum: 0,
    description: 'The action item’s place in its minutes’ list, from 0.',
  })
  index!: number;

  @ApiProperty()
  text!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  owner_user_id!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'A calendar day, `YYYY-MM-DD`.',
  })
  due_date!: string | null;

  @ApiProperty({
    type: ActionItemTaskGroupDto,
    nullable: true,
    description: 'A task for everyone: how many of its copies are done.',
  })
  group!: ActionItemTaskGroupDto | null;
}

/** One posted minutes of a series and its open action items. */
export class SeriesOpenActionItemsDto {
  @ApiProperty({ format: 'uuid' })
  meeting_id!: string;

  @ApiProperty({ format: 'date-time' })
  event_start_time!: string;

  @ApiProperty({ type: [OpenActionItemDto] })
  items!: OpenActionItemDto[];
}
