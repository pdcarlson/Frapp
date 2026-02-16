import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { OnboardingInitSchema } from '@repo/validation';

export class OnboardingInitDto extends createZodDto(OnboardingInitSchema) {
  @ApiProperty({ description: 'The formal name of the fraternity chapter' })
  name: string;

  @ApiProperty({ description: 'The university or institution name' })
  university: string;

  @ApiProperty({
    description: 'Optional Clerk Organization ID if already created',
  })
  clerkOrganizationId?: string;
}
