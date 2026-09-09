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
import { POINTS_ADJUSTMENT_MAX, RECURRENCE_RULES } from '@repo/validation';
import type { Event } from '#domain/entities/event.entity';
import type { GeofenceCoordinate } from '#domain/entities/study.entity';
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
  @IsIn(RECURRENCE_RULES)
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
      'When set with `client_message_id`, posts an interactive event card to this chat channel after the event is created (the `/event` slash command). Omit for dashboard creates. Rejected with a 400 when `required_role_ids` is non-empty, on this key or `client_message_id` alone — the card is broadcast to every reader of the channel, so a create cannot both target roles and post one. (`PATCH` can still add targeting to an event whose card already posted; that card is left as-is.)',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`. Rejected with a 400 when `required_role_ids` is non-empty, even without `channel_id` — see that field.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

/**
 * Response contract for `POST /v1/events`.
 *
 * This route previously declared no response schema, which openapi-typescript
 * renders as `content?: never` — so `data` reached the SDK typed `never` and
 * `/event` could not read `card_posted` without an unchecked cast (#1717). The
 * event fields are flattened at the top level exactly as the route already
 * returned them: the **parent** row. Recurring children are side effects of
 * create and are not in this body; do not invent an `occurrences[]` field.
 *
 * Drift between this class and the event row is caught the same way as
 * `AdjustPointsResponseDto`: `implements Event` for type drift, and the
 * `Assert<Exclude<…>>` aliases below for key drift. `card_posted` is the one
 * deliberate extra field.
 */
export class CreateEventResponseDto implements Event {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ format: 'date-time' })
  start_time: string;

  @ApiProperty({ format: 'date-time' })
  end_time: string;

  @ApiProperty()
  point_value: number;

  @ApiProperty()
  is_mandatory: boolean;

  @ApiProperty({ type: String, nullable: true })
  recurrence_rule: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parent_event_id: string | null;

  @ApiProperty({ type: [String], nullable: true })
  required_role_ids: string[] | null;

  @ApiProperty({ type: String, nullable: true })
  notes: string | null;

  @ApiProperty({
    type: [GeofenceCoordinateDto],
    nullable: true,
    description:
      'Optional check-in geofence. `null` means the event has no zone.',
  })
  check_in_zone: GeofenceCoordinate[] | null;

  @ApiProperty({ type: String, nullable: true })
  check_in_zone_name: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Only an explicit `false` is actionable: the event row committed and the card did not, so no Realtime echo will arrive to reconcile the caller’s optimistic placeholder — drop it and warn, without implying the create failed. Absent means the server reported no outcome (a dashboard create, or a request that did not attempt a card) — leave the placeholder for the echo. Full contract: `spec/behavior/chat/integrations.md` § Slash command dispatch.',
  })
  card_posted?: boolean;
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
  @IsIn(RECURRENCE_RULES)
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

/**
 * Compile-time key-drift guards between {@link CreateEventResponseDto} and the
 * event row it publishes. Each resolves to `never` while the two agree; when
 * they diverge the alias stops satisfying `Assert`'s constraint and the build
 * fails naming the field.
 */
type Assert<T extends never> = T;

/** Event fields {@link CreateEventResponseDto} forgot to declare. Must be `never`. */
export type CreateEventResponseDtoMissingFields = Assert<
  Exclude<keyof Event, keyof CreateEventResponseDto>
>;

/**
 * Fields {@link CreateEventResponseDto} declares that the event row does not
 * carry. Must be `never`. `card_posted` is excluded because it is this route's
 * own outcome flag, not a column — the one deliberate addition.
 */
export type CreateEventResponseDtoExtraFields = Assert<
  Exclude<keyof CreateEventResponseDto, keyof Event | 'card_posted'>
>;
