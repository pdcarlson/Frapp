import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { POINTS_ADJUSTMENT_MAX } from '@repo/validation';
import { GeofenceCoordinateDto } from './study.dto';

/**
 * Swagger/validation description shared by the create and update zone fields.
 * The polygon shape is identical to `study_geofences.coordinates` so one
 * `pointInPolygon` (`domain/utils/geofence.ts`) serves both features.
 */
const CHECK_IN_ZONE_DESCRIPTION =
  'Optional check-in geofence: polygon vertices a member must stand inside to check in. At least 3 points; the closing edge is implicit. Omit for an event with no geofence.';

export class CreateEventDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty()
  @IsISO8601()
  start_time: string;

  @ApiProperty()
  @IsISO8601()
  end_time: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  // Written to point_transactions.amount once per check-in, so it is a ledger
  // write and carries the same ceiling as a manual adjustment.
  @Max(POINTS_ADJUSTMENT_MAX)
  point_value?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Recurrence rule (e.g. WEEKLY, BIWEEKLY, MONTHLY)',
  })
  @IsOptional()
  @IsString()
  // Only the three rules the generator understands. Anything else was accepted
  // and then silently generated nothing; on a series edit that meant deleting
  // the future occurrences and rebuilding none of them. `null` still clears a
  // series (@IsOptional short-circuits this).
  @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY'])
  recurrence_rule?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_role_ids?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    type: [GeofenceCoordinateDto],
    description: CHECK_IN_ZONE_DESCRIPTION,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ValidateNested({ each: true })
  @Type(() => GeofenceCoordinateDto)
  check_in_zone?: GeofenceCoordinateDto[];

  @ApiPropertyOptional({
    description:
      'Human-readable name for `check_in_zone`, shown on the mobile scanner ("Inside the Great Hall zone").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  check_in_zone_name?: string;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts an interactive event card to this chat channel after the event is created (the `/event` slash command). Omit for dashboard creates. Rejected with a 400 when `required_role_ids` is non-empty — the card is broadcast to every reader of the channel, so a role-targeted event cannot have one.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

/**
 * Which occurrences of a recurring event a write applies to.
 *
 * Two values, not the calendar-app three: `spec/behavior/events.md` § Recurring
 * events allows individual edits and future-only series changes, and nothing
 * else. Omitting it means `instance`, so every pre-existing caller keeps its
 * current single-row behavior.
 */
const EVENT_SCOPE_DESCRIPTION =
  'Which occurrences this applies to. `instance` (default) affects only this event. `series` affects the whole recurring series from now forward — occurrences that have already started are never modified or deleted, so attendance history is preserved.';

export class UpdateEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  start_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  end_time?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  // Written to point_transactions.amount once per check-in, so it is a ledger
  // write and carries the same ceiling as a manual adjustment.
  @Max(POINTS_ADJUSTMENT_MAX)
  point_value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiPropertyOptional({
    description: 'Recurrence rule (e.g. WEEKLY, BIWEEKLY, MONTHLY)',
  })
  @IsOptional()
  @IsString()
  // Only the three rules the generator understands. Anything else was accepted
  // and then silently generated nothing; on a series edit that meant deleting
  // the future occurrences and rebuilding none of them. `null` still clears a
  // series (@IsOptional short-circuits this).
  @IsIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY'])
  recurrence_rule?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_role_ids?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    type: [GeofenceCoordinateDto],
    description: `${CHECK_IN_ZONE_DESCRIPTION} Send an empty array to clear an existing zone.`,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeofenceCoordinateDto)
  check_in_zone?: GeofenceCoordinateDto[];

  @ApiPropertyOptional({
    description:
      'Human-readable name for `check_in_zone`, shown on the mobile scanner ("Inside the Great Hall zone").',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  check_in_zone_name?: string;

  // No `default:` here on purpose. `openapi-typescript` promotes any property
  // carrying a schema default to *required* in the generated SDK type (the same
  // reason `CreateEventDto.point_value` generates non-optional), which would
  // force every existing caller of the update hook to pass a scope. The default
  // is stated in the description and applied in the service signature instead.
  @ApiPropertyOptional({
    enum: ['instance', 'series'],
    description: EVENT_SCOPE_DESCRIPTION,
  })
  @IsOptional()
  @IsIn(['instance', 'series'])
  scope?: 'instance' | 'series';
}

/**
 * Query string for `DELETE /v1/events/:id`.
 *
 * A dedicated class rather than a bare `@Query('scope')` because the global
 * pipe runs `forbidNonWhitelisted`, so an undeclared query property is a 400 —
 * and because it is what puts the enum into the OpenAPI contract.
 */
export class DeleteEventQueryDto {
  @ApiPropertyOptional({
    enum: ['instance', 'series'],
    description: EVENT_SCOPE_DESCRIPTION,
  })
  @IsOptional()
  @IsIn(['instance', 'series'])
  scope?: 'instance' | 'series';
}
