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

  @ApiProperty({ type: String, nullable: true })
  avatar_url: string | null;

  @ApiProperty({ type: String, nullable: true })
  bio: string | null;

  @ApiProperty({ type: Number, nullable: true })
  graduation_year: number | null;

  @ApiProperty({ type: String, nullable: true })
  current_city: string | null;

  @ApiProperty({ type: String, nullable: true })
  current_company: string | null;

  @ApiProperty()
  email: string;
}
