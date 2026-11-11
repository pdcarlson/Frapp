import { ApiProperty } from '@nestjs/swagger';

/**
 * The shape `GET /v1/custom-roles` answered before #4075 folded custom roles
 * into ordinary roles. Kept so the deprecated route still matches the contract
 * the shipped mobile builds were made against; the route now returns `[]`.
 */
export class CustomRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  rank: number;

  @ApiProperty({ type: [String] })
  capabilities: string[];

  @ApiProperty()
  core: boolean;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}
