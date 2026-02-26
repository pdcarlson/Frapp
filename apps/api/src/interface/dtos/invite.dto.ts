import { IsString, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiProperty({ description: 'Role name to assign to invited member' })
  @IsString()
  role: string;
}

export class BatchCreateInvitesDto {
  @ApiProperty({ description: 'Role name to assign' })
  @IsString()
  role: string;

  @ApiProperty({ description: 'Number of invites to generate' })
  @IsInt()
  @Min(1)
  @Max(50)
  count: number;
}

export class RedeemInviteDto {
  @ApiProperty()
  @IsString()
  token: string;
}
