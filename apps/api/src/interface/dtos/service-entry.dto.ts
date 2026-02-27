import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateServiceEntryDto {
  @ApiProperty({ description: 'Date of service (YYYY-MM-DD)' })
  @IsString()
  date: string;

  @ApiProperty({
    description: 'Duration in minutes',
    minimum: 1,
    example: 60,
  })
  @IsInt()
  @Min(1)
  duration_minutes: number;

  @ApiProperty({ description: 'Description of the service performed' })
  @IsString()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional({
    description: 'Storage path to proof file (e.g. from upload)',
  })
  @IsOptional()
  @IsString()
  proof_path?: string;
}

export class ReviewServiceEntryDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Optional comment for the member (especially on rejection)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  review_comment?: string;
}
