import { IsString, IsNotEmpty, IsNumber, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInvoiceDto {
  @ApiProperty({ example: 'Fall 2026 Dues' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Semester membership fees', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 50000, description: 'Amount in cents ($500.00)' })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ example: '2026-09-01T00:00:00Z' })
  @IsDateString()
  dueDate: string;
}
