import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
  Equals,
  ValidateBy,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { isInviteEmail, MAX_INVITE_EMAILS } from '@repo/validation';
import type {
  BulkEmailInviteResult,
  InviteListItem,
  InviteStatus,
} from '../../application/services/invite.service';
import type {
  InviteDetails,
  InviteLinkState,
  InvitePreview,
  PendingInvite,
} from '../../application/services/invite.service';

/**
 * #422: `role` is optional on all three create routes. Omitting it falls back
 * to the chapter's configured `default_invite_role_id`, then to the seeded
 * Everyone role (once Member, #4191), so a caller that never learned about
 * roles still issues a sensible invite, and a chapter that set a default does
 * not have to restate it on every call. Naming a role still wins, so no existing caller changes
 * behaviour.
 */
const ROLE_DESCRIPTION =
  "Role name to assign: one of the chapter's roles (400 otherwise), ranked below the caller and never one carrying `*` (403 otherwise; #1830). Omit to use the chapter's configured default invite role.";

export class CreateInviteDto {
  @ApiPropertyOptional({ description: ROLE_DESCRIPTION })
  @IsOptional()
  @IsString()
  role?: string;
}

export class BatchCreateInvitesDto {
  @ApiPropertyOptional({ description: ROLE_DESCRIPTION })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ description: 'Number of invites to generate' })
  @IsInt()
  @Min(1)
  @Max(50)
  count: number;
}

/**
 * The web composer's own check (`isInviteEmail`), so an address it lets
 * through is never the one that 400s the whole batch here.
 */
function IsInviteEmail() {
  return ValidateBy(
    {
      name: 'isInviteEmail',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isInviteEmail(value),
        defaultMessage: () => 'each value in emails must be an email',
      },
    },
    { each: true },
  );
}

export class BulkEmailInviteDto {
  @ApiPropertyOptional({ description: ROLE_DESCRIPTION })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({
    description: 'Email addresses to invite, one invite token per address',
    type: [String],
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INVITE_EMAILS)
  @IsInviteEmail()
  emails: string[];
}

export class RedeemInviteDto {
  @ApiProperty()
  @IsString()
  token: string;

  /**
   * The user's agreement to the current Terms (#2302). Required, as `true`,
   * only when the caller hasn't accepted the current Terms; `GET
   * /v1/users/me/legal-acceptance` says which. The server stamps the record,
   * so this is the user's claim, not the record itself. The join screens send
   * it on every join (#5625): their Terms line under the buttons ("By joining
   * you agree to…", `termsLine` in `@repo/validation`) is the agreement, and
   * the old checkbox (`LEGAL_ACCEPTANCE_LABEL`) is gone from them.
   */
  @ApiPropertyOptional({
    description:
      'True when the user agreed to the current Terms of Service and Privacy Policy: the join screens send it on every join, under their one-line Terms notice. Needed only if they have not accepted the current version.',
  })
  @IsOptional()
  @IsStrictBoolean()
  @Equals(true, {
    message: 'Terms of Service and Privacy Policy must be accepted',
  })
  accept_terms_privacy?: boolean;
}

export class PreviewInviteDto {
  @ApiProperty({ description: 'The invite token, as the join link carries it' })
  @IsString()
  token: string;
}

/** `InvitePreview` in `invite.service.ts`, for the contract (#3352). */
export class InvitePreviewResponseDto implements InvitePreview {
  @ApiProperty()
  chapter_name: string;

  @ApiProperty()
  university: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "The chapter's text mark: its short name, else its Greek letters if it shows them, else null. Never letters the chapter hides, nor those of an organization that never displays them (such as Phi Gamma Delta), whatever the chapter's stored switch says (#3421).",
  })
  mark_text: string | null;

  @ApiProperty({ nullable: true, type: String })
  accent_color: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: "The inviter's display name, or null when it can't be read.",
  })
  invited_by: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The role name joining grants, or null when it names none: the invite grants only the Everyone role every member holds (#4191), or the invite role is gone and the chapter has no Everyone role to fall back to',
  })
  role: string | null;

  @ApiProperty()
  expires_at: string;
}

/** `InviteDetails` in `invite.service.ts`: the invite screen's card (#5625). */
export class InviteDetailsResponseDto
  extends InvitePreviewResponseDto
  implements InviteDetails
{
  @ApiProperty({
    enum: ['live', 'expired', 'used', 'off', 'locked'],
    description:
      "Whether the link still works: `live`; `expired`; `used` (a personal invite someone already joined with); `off` (revoked, or its sender can no longer grant its role); `locked` (a working link into a chapter whose subscription is inactive, so it can't take new members until it's restored). Only `live` can be joined.",
  })
  state: InviteLinkState;

  @ApiProperty({
    format: 'uuid',
    description:
      "The invite's chapter, so a signed-in visitor already in it is told so instead of offered Join.",
  })
  chapter_id: string;

  @ApiProperty({
    description:
      'How many members the chapter has now. 0 when the link does not work: only a live link earns the count.',
    example: 41,
  })
  member_count: number;

  @ApiProperty({
    format: 'date-time',
    description:
      'When the invite was made, for a dead card ("sent it on Friday, November 14").',
  })
  sent_at: string;
}

/** One row of `GET /v1/invites/mine` (`PendingInvite`, #3776). */
export class PendingInviteDto
  extends InvitePreviewResponseDto
  implements PendingInvite
{
  @ApiProperty({
    description:
      'The single-use token, for redeem. Returned only because the invite was emailed to the address Auth verified for the caller.',
  })
  token: string;
}

const INVITE_STATUSES: InviteStatus[] = [
  'pending',
  'joined',
  'expired',
  'revoked',
];

/** One row of `GET /v1/invites` (`InviteListItem`, #3607). */
export class InviteListItemDto implements InviteListItem {
  @ApiProperty()
  id: string;

  @ApiProperty({
    description:
      'The single-use token. Clients build the join link from it; they never show it.',
  })
  token: string;

  @ApiProperty({ description: 'The role name joining grants' })
  role: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The address the invite was emailed to, or null for a share-link invite',
  })
  email: string | null;

  @ApiProperty({
    enum: INVITE_STATUSES,
    enumName: 'InviteStatus',
    description:
      'pending: still joinable. joined: someone joined with it. expired: unused past expires_at. revoked: an officer revoked it.',
  })
  status: InviteStatus;

  @ApiProperty()
  expires_at: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Set when it was used, and also when it was revoked',
  })
  used_at: string | null;

  @ApiProperty({ nullable: true, type: String })
  revoked_at: string | null;

  @ApiProperty()
  created_at: string;

  @ApiProperty({
    description:
      'True for the chapter link (#3353): anyone with it joins until it expires or an officer turns it off, so it never reads joined.',
  })
  reusable: boolean;
}

/** `GET /v1/invites/chapter-link` (#3353). */
export class ChapterLinkResponseDto {
  @ApiProperty({
    type: InviteListItemDto,
    nullable: true,
    description:
      "The chapter's link that no officer has turned off, expired or not (status says which). Null when there is none, or when it grants a role the caller couldn't invite someone into.",
  })
  link: InviteListItemDto | null;
}

/** `GET /v1/invites/roles` (#4546). */
export class InvitableRolesDto {
  @ApiProperty({
    type: [String],
    description:
      'Ids of the roles the caller may invite someone into. Match them against GET /v1/roles for names.',
  })
  role_ids: string[];
}

/** `POST /v1/invites/email`'s answer (`BulkEmailInviteResult`). */
export class BulkEmailInviteResponseDto implements BulkEmailInviteResult {
  @ApiProperty({ type: InviteListItemDto, isArray: true })
  invites: InviteListItemDto[];

  @ApiProperty({
    type: [String],
    description:
      'Addresses whose invite was created but whose email did not send. Their invites still work as links.',
  })
  failed: string[];
}
