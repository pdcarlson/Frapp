import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  RushBidStatus,
  RushCandidate,
  RushCandidateView,
} from '#domain/entities/rush-candidate.entity';

export class CreateRushCandidateDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  display_name: string;

  @ApiPropertyOptional({
    description:
      'When the candidate is already a chapter member, the resolved user id. Omit for an external prospect.',
  })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({
    description:
      'When set with `client_message_id`, posts a rush candidate card to this chat channel after the row is created (the vocab-aware slash command). Omit for non-chat creates.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @ApiPropertyOptional({
    description:
      'Client-generated idempotency key for the chat card, reconciling the optimistic loading placeholder. Required alongside `channel_id`. Not a server-side dedupe key — a replay creates a duplicate candidate.',
  })
  @IsOptional()
  @IsUUID()
  client_message_id?: string;
}

export class LookupRushCandidateQueryDto {
  @ApiProperty({ description: 'Candidate display name (case-insensitive)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}

/**
 * Response contract for `POST /v1/rush/candidates`.
 *
 * Flattened candidate row plus the three-way `card_posted` flag used by
 * `/hours` / `/task` / `/event`. `name_key` is included because it is a
 * column; clients should not display it.
 */
export class CreateRushCandidateResponseDto implements RushCandidate {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  display_name: string;

  @ApiProperty()
  name_key: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  user_id: string | null;

  @ApiProperty()
  stage: string;

  @ApiProperty({ enum: ['none', 'extended'] })
  bid_status: RushBidStatus;

  @ApiProperty({ format: 'uuid' })
  created_by: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiPropertyOptional({
    description:
      'Whether the accompanying chat card was posted. Only an explicit `false` is actionable: the candidate row committed and the card did not. Absent means no card was attempted. Full contract: `spec/behavior/chat/integrations.md` § Slash command dispatch.',
  })
  card_posted?: boolean;
}

export class RushCandidateViewDto implements RushCandidateView {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  display_name: string;

  @ApiProperty()
  name_key: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  user_id: string | null;

  @ApiProperty()
  stage: string;

  @ApiProperty({ enum: ['none', 'extended'] })
  bid_status: RushBidStatus;

  @ApiProperty({ format: 'uuid' })
  created_by: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ description: 'Ballot count. Voter names are never returned.' })
  vote_count: number;

  @ApiProperty({
    description: 'Whether the authenticated caller has already voted.',
  })
  viewer_has_voted: boolean;
}

type Assert<T extends never> = T;

export type CreateRushCandidateResponseDtoMissingFields = Assert<
  Exclude<keyof RushCandidate, keyof CreateRushCandidateResponseDto>
>;

export type CreateRushCandidateResponseDtoExtraFields = Assert<
  Exclude<
    keyof CreateRushCandidateResponseDto,
    keyof RushCandidate | 'card_posted'
  >
>;

export type RushCandidateViewDtoMissingFields = Assert<
  Exclude<keyof RushCandidateView, keyof RushCandidateViewDto>
>;

export type RushCandidateViewDtoExtraFields = Assert<
  Exclude<keyof RushCandidateViewDto, keyof RushCandidateView>
>;
