import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiProperty({
    description: 'The role assigned to the new member',
    example: 'member',
  })
  @IsString()
  @IsNotEmpty()
  role: string;
}

export class AcceptInviteDto {
  @ApiProperty({ description: 'The secure token from the invite' })
  @IsString()
  @IsNotEmpty()
  token: string;
}
