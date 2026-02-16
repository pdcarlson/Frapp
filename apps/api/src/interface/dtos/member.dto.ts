import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { UpdateMemberRolesSchema } from '@repo/validation';

export class UpdateMemberRolesDto extends createZodDto(
  UpdateMemberRolesSchema,
) {
  @ApiProperty({ example: ['role-uuid-1', 'role-uuid-2'] })
  roleIds: string[];
}

export class MemberResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  chapterId: string;

  @ApiProperty({ type: [String] })
  roleIds: string[];

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
