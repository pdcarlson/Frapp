import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OnboardingInitDto {
  @ApiProperty({ description: 'The formal name of the fraternity chapter' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'The university or institution name' })
  @IsString()
  @IsNotEmpty()
  university: string;

  @ApiProperty({
    description: 'Optional Clerk Organization ID if already created',
  })
  @IsString()
  @IsOptional()
  clerkOrganizationId?: string;
}
