import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BillingModule } from '../billing/billing.module'; // To get StripeService
import { UserModule } from '../user/user.module';
import { FinancialService } from '../../application/services/financial.service';
import { DrizzleFinancialRepository } from '../../infrastructure/database/repositories/drizzle-financial.repository';
import { FINANCIAL_REPOSITORY } from '../../domain/repositories/financial.repository.interface';
import { FinancialController } from '../../interface/controllers/financial.controller';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    forwardRef(() => BillingModule),
    RbacModule,
  ],
  controllers: [FinancialController],
  providers: [
    FinancialService,
    {
      provide: FINANCIAL_REPOSITORY,
      useClass: DrizzleFinancialRepository,
    },
  ],
  exports: [FinancialService],
})
export class FinancialModule {}
