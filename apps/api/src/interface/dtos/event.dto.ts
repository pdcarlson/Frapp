import {
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHECK_IN_GRACE_MINUTES,
  DEFAULT_CHECK_IN_OPENS_MINUTES,
  MAX_CHECK_IN_OPENS_MINUTES,
  POINTS_ADJUSTMENT_MAX,
  RECURRENCE_RULES,
} from '@repo/validation';
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

  @ApiPropertyOptional({
    default: 10,
    description:
      "Points for attending. On create, kept only when the caller holds `events:update`; anyone else's event is stored with 0, whatever is sent (#3709).",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  // Written to point_transactions.amount once per check-in, so it is a ledger
  // write and carries the same ceiling as a manual adjustment.
  @Max(POINTS_ADJUSTMENT_MAX)
  point_value?: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Whether everyone the event invites must attend. On create, true (or a non-empty `required_role_ids`) is a 403 unless the caller holds `events:update` (#3709).',
  })
  @IsOptional()
  @IsStrictBoolean()
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

  @ApiPropertyOptional({
    type: [String],
    description:
      'Roles that must attend. See `others_invited` for members holding none of the listed roles.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_role_ids?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Roles invited but not required.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optional_role_ids?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Roles not invited: their holders do not see the event and cannot check in, unless another role of theirs is listed as required or optional.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excluded_role_ids?: string[];

  @ApiPropertyOptional({
    description:
      'Whether a member holding none of the listed roles is invited (then `is_mandatory` says whether they must attend). Omitted on create, it is stored as null, which reads as true unless `required_role_ids` is non-empty: the older "only these roles" meaning, for a caller that predates this field. Omitted on update, it is left as stored.',
  })
  @IsOptional()
  @IsStrictBoolean()
  others_invited?: boolean;

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

  // No `default:` in the schema on purpose: `openapi-typescript` turns a
  // defaulted property required in the generated SDK type, which would break
  // every existing create and update call. The default is applied server-side.
  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_CHECK_IN_OPENS_MINUTES,
    description: `Minutes before start_time that check-in opens. Omitted on create, it is ${DEFAULT_CHECK_IN_OPENS_MINUTES}; the window closes ${CHECK_IN_GRACE_MINUTES} minutes after end_time.`,
  })
  // Absent means the default; `null` is refused (400), never stored: the
  // column is not null, and `@IsOptional` alone would let null through to a
  // 500 from the database.
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_CHECK_IN_OPENS_MINUTES)
  check_in_opens_minutes?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "One of the chapter's event types (`GET /v1/event-types`), or null for none. The type only fills the form: the event's own `point_value` and `is_mandatory` are what count. An id that isn't the chapter's is a 400.",
  })
  @IsOptional()
  @IsUUID()
  event_type_id?: string | null;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts an interactive event card to this chat channel after the event is created (the `/event` slash command). Omit for dashboard creates. Rejected with a 400 when the event keeps anyone out (`others_invited` false, including its default when `required_role_ids` is non-empty, or a non-empty `excluded_role_ids`), on this key or `client_message_id` alone — the card is broadcast to every reader of the channel, so a create cannot both limit its audience and post one. (`PATCH` can still limit the audience of an event whose card already posted; that card is left as-is.)',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`. Rejected with a 400 when the event keeps anyone out, even without `channel_id` — see that field.',
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

  @ApiProperty({ type: [String], nullable: true })
  optional_role_ids: string[] | null;

  @ApiProperty({ type: [String], nullable: true })
  excluded_role_ids: string[] | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Null on a row written without it: read it as true unless `required_role_ids` is non-empty (`eventOthersInvited` in `@repo/validation`).',
  })
  others_invited: boolean | null;

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

  @ApiProperty({
    minimum: 0,
    maximum: MAX_CHECK_IN_OPENS_MINUTES,
    description: `Minutes before start_time that check-in opens; it closes ${CHECK_IN_GRACE_MINUTES} minutes after end_time.`,
  })
  check_in_opens_minutes: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The chapter's event type this was made as, or null. Cleared when the type is deleted.",
  })
  event_type_id: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Who made the event. Null for events made before it was recorded.',
  })
  created_by: string | null;

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
  @IsStrictBoolean()
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

  @ApiPropertyOptional({
    type: [String],
    description:
      'Roles that must attend. See `others_invited` for members holding none of the listed roles.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_role_ids?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Roles invited but not required.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optional_role_ids?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Roles not invited: their holders do not see the event and cannot check in, unless another role of theirs is listed as required or optional.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excluded_role_ids?: string[];

  @ApiPropertyOptional({
    description:
      'Whether a member holding none of the listed roles is invited (then `is_mandatory` says whether they must attend). Omitted, it is left as stored. A stored null reads as true unless `required_role_ids` is non-empty, the older "only these roles" meaning.',
  })
  @IsOptional()
  @IsStrictBoolean()
  others_invited?: boolean;

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

  // No `default:` in the schema on purpose: `openapi-typescript` turns a
  // defaulted property required in the generated SDK type, which would break
  // every existing create and update call. The default is applied server-side.
  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_CHECK_IN_OPENS_MINUTES,
    description: `Minutes before start_time that check-in opens; the window closes ${CHECK_IN_GRACE_MINUTES} minutes after end_time. Omitted leaves it unchanged; null is refused.`,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_CHECK_IN_OPENS_MINUTES)
  check_in_opens_minutes?: number;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "One of the chapter's event types (`GET /v1/event-types`), or null to clear it; omitted leaves it. The type only fills the form: the event's own `point_value` and `is_mandatory` are what count. An id that isn't the chapter's is a 400.",
  })
  @IsOptional()
  @IsUUID()
  event_type_id?: string | null;

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
