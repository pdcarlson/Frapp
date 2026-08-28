import {
  IsString,
  IsOptional,
  IsInt,
  IsUUID,
  IsIn,
  IsDateString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  INVOICE_AMOUNT_MAX_CENTS,
  INVOICE_DESCRIPTION_MAX_LENGTH,
  INVOICE_TITLE_MAX_LENGTH,
} from '@repo/validation';

export class CreateFinancialInvoiceDto {
  @ApiProperty({ description: 'Member user ID to invoice' })
  @IsUUID()
  user_id: string;

  @ApiProperty({
    description: 'Invoice title (e.g. "Fall 2026 Dues")',
    maxLength: INVOICE_TITLE_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(INVOICE_TITLE_MAX_LENGTH)
  title: string;

  @ApiPropertyOptional({ maxLength: INVOICE_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiProperty({
    description: 'Amount in cents (e.g. 15000 = $150.00)',
    minimum: 1,
    maximum: INVOICE_AMOUNT_MAX_CENTS,
  })
  @IsInt()
  @Min(1)
  @Max(INVOICE_AMOUNT_MAX_CENTS)
  amount: number;

  @ApiProperty({ description: 'Due date (ISO date string)' })
  @IsDateString()
  due_date: string;
}

export class UpdateFinancialInvoiceDto {
  @ApiPropertyOptional({ maxLength: INVOICE_TITLE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: INVOICE_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Amount in cents',
    minimum: 1,
    maximum: INVOICE_AMOUNT_MAX_CENTS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(INVOICE_AMOUNT_MAX_CENTS)
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
