import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsISO8601, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ListChapterAuditLogQueryDto {
  @ApiPropertyOptional({
    description:
      'ISO8601 cursor — return audit entries created before this timestamp',
  })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({
    description:
      'Max entries to return. Integers are clamped to 1–200 inclusive; omitted defaults to 50.',
    minimum: 1,
    maximum: 200,
    default: 50,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
