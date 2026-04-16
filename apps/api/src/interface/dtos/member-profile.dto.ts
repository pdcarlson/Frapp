import { ApiProperty } from '@nestjs/swagger';

export class MemberProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  user_id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty({ type: [String] })
  role_ids: string[];

  @ApiProperty()
  has_completed_onboarding: boolean;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;

  @ApiProperty()
  display_name: string;

  @ApiProperty({ nullable: true })
  avatar_url: string | null;

  @ApiProperty({ nullable: true })
  bio: string | null;

  @ApiProperty({ nullable: true })
  graduation_year: number | null;

  @ApiProperty({ nullable: true })
  current_city: string | null;

  @ApiProperty({ nullable: true })
  current_company: string | null;

  @ApiProperty()
  email: string;
}
