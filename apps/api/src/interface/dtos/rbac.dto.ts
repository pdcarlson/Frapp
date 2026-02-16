import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { CreateRoleSchema } from '@repo/validation';

export class CreateRoleDto extends createZodDto(CreateRoleSchema) {
  @ApiProperty({ example: 'Social Chair' })
  declare name: string;

  @ApiProperty({ example: ['events:create', 'events:update'] })
  declare permissions: string[];
}

export class RoleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chapterId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  permissions: string[];

  @ApiProperty()
  isSystem: boolean;

  @ApiProperty()
  createdAt: string;
}
