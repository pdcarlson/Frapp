import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsIn,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFinancialInvoiceDto {
  @ApiProperty({ description: 'Member user ID to invoice' })
  @IsUUID()
  user_id: string;

  @ApiProperty({ description: 'Invoice title (e.g. "Fall 2026 Dues")' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Amount in cents (e.g. 15000 = $150.00)' })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Due date (ISO date string)' })
  @IsDateString()
  due_date: string;
}

export class UpdateFinancialInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Amount in cents' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  due_date?: string;
}

export class TransitionInvoiceStatusDto {
  @ApiProperty({
    description: 'New invoice status',
    enum: ['OPEN', 'PAID', 'VOID'],
  })
  @IsIn(['OPEN', 'PAID', 'VOID'])
  status: 'OPEN' | 'PAID' | 'VOID';
}
