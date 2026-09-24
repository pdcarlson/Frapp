import { Module } from '@nestjs/common';
import { ClientPolicyService } from '../../application/services/client-policy.service';
import { ClientPolicyController } from '../../interface/controllers/client-policy.controller';

@Module({
  controllers: [ClientPolicyController],
  providers: [ClientPolicyService],
})
export class ClientPolicyModule {}
