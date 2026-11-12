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
import {
  isInviteEmail,
  LEGAL_ACCEPTANCE_LABEL,
  MAX_INVITE_EMAILS,
} from '@repo/validation';
import type {
  BulkEmailInviteResult,
  InviteListItem,
  InviteStatus,
} from '../../application/services/invite.service';
import type {
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
  "Role name to assign. Omit to use the chapter's configured default invite role.";

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
   * The join screen's Terms checkbox (#2302). Required, as `true`, only when
   * the caller hasn't accepted the current Terms; `GET
   * /v1/users/me/legal-acceptance` says which. The server stamps the record,
   * so this is the user's claim that they ticked it, not the record itself.
   */
  @ApiPropertyOptional({
    description: `True when the user ticked "${LEGAL_ACCEPTANCE_LABEL}" Needed only if they haven't accepted the current version.`,
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
