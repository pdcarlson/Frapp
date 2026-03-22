import { Module } from '@nestjs/common';
import { FinancialInvoiceService } from '../../application/services/financial-invoice.service';
import { FinancialInvoiceController } from '../../interface/controllers/financial-invoice.controller';
import { SupabaseFinancialInvoiceRepository } from '../../infrastructure/supabase/repositories/supabase-financial-invoice.repository';
import { SupabaseFinancialTransactionRepository } from '../../infrastructure/supabase/repositories/supabase-financial-transaction.repository';
import { FINANCIAL_INVOICE_REPOSITORY } from '../../domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '../../domain/repositories/financial-transaction.repository.interface';
import { NotificationModule } from '../notification/notification.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [NotificationModule, RbacModule],
  controllers: [FinancialInvoiceController],
  providers: [
    FinancialInvoiceService,
    {
      provide: FINANCIAL_INVOICE_REPOSITORY,
      useClass: SupabaseFinancialInvoiceRepository,
    },
    {
      provide: FINANCIAL_TRANSACTION_REPOSITORY,
      useClass: SupabaseFinancialTransactionRepository,
    },
  ],
  exports: [FinancialInvoiceService],
})
export class FinancialInvoiceModule {}
