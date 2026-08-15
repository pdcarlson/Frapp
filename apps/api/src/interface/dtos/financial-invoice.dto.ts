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

/**
 * Ceiling for an invoice amount, in cents. Anchored to Stripe's own per-charge
 * maximum for USD (99,999,999 = $999,999.99): an invoice above it could never
 * be paid through the checkout path anyway, so accepting one only stores a row
 * that is guaranteed to fail at payment time.
 */
const MAX_INVOICE_AMOUNT_CENTS = 99_999_999;

/** Free-text note rendered on the invoice; capped so the column stays bounded. */
const MAX_INVOICE_DESCRIPTION_LENGTH = 2000;

export class CreateFinancialInvoiceDto {
  @ApiProperty({ description: 'Member user ID to invoice' })
  @IsUUID()
  user_id: string;

  @ApiProperty({ description: 'Invoice title (e.g. "Fall 2026 Dues")' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ maxLength: MAX_INVOICE_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_INVOICE_DESCRIPTION_LENGTH)
  description?: string;

  @ApiProperty({
    description: 'Amount in cents (e.g. 15000 = $150.00)',
    minimum: 1,
    maximum: MAX_INVOICE_AMOUNT_CENTS,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_INVOICE_AMOUNT_CENTS)
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

  @ApiPropertyOptional({ maxLength: MAX_INVOICE_DESCRIPTION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_INVOICE_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({
    description: 'Amount in cents',
    minimum: 1,
    maximum: MAX_INVOICE_AMOUNT_CENTS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INVOICE_AMOUNT_CENTS)
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
