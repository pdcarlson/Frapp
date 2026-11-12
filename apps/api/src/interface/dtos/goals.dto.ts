import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { GOAL_ROLE_LIMIT, GOAL_TARGET_MAX } from '@repo/validation';
import {
  GOAL_METRICS,
  type GoalMetric,
  type GoalSet,
  type RoleGoal,
} from '#domain/entities/chapter-goal.entity';
import type { ChapterGoals } from '../../application/services/chapter-goal.service';

/**
 * The largest target any measure takes. The DTO can't see which measure the
 * path names, so it caps at the widest; `ChapterGoalService.setGoals` then
 * holds each measure to its own ceiling (`GOAL_TARGET_MAX`).
 */
const TARGET_CEILING = Math.max(...Object.values(GOAL_TARGET_MAX));

export class GoalMetricParamDto {
  @ApiProperty({ enum: GOAL_METRICS })
  @IsIn(GOAL_METRICS)
  metric!: GoalMetric;
}

export class RoleGoalDto implements RoleGoal {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  role_id!: string;

  @ApiProperty({
    description:
      'Points for a points goal; minutes for a service or study goal.',
  })
  @IsInt()
  @Min(1)
  @Max(TARGET_CEILING)
  target!: number;
}

export class GoalSetDto implements GoalSet {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Every member's goal (points, or minutes for hours), or null for none.",
  })
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(TARGET_CEILING)
  everyone!: number | null;

  @ApiProperty({
    type: [RoleGoalDto],
    description:
      'Roles held to a different goal. A member with several is held to the one on their highest-ranked role.',
  })
  @IsArray()
  @ArrayMaxSize(GOAL_ROLE_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => RoleGoalDto)
  roles!: RoleGoalDto[];
}

export class ChapterGoalsDto implements ChapterGoals {
  @ApiProperty({ type: GoalSetDto, description: 'Points this semester.' })
  points!: GoalSetDto;

  @ApiProperty({
    type: GoalSetDto,
    description: 'Approved service minutes this semester.',
  })
  service!: GoalSetDto;

  @ApiProperty({
    type: GoalSetDto,
    description: 'Study minutes this week (Sunday to Saturday).',
  })
  study!: GoalSetDto;
}
