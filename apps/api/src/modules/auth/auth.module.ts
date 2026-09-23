import { Module } from '@nestjs/common';
import { AuthService } from '../../application/services/auth.service';
import { LegalAcceptanceService } from '../../application/services/legal-acceptance.service';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';

@Module({
  providers: [
    AuthService,
    // Lives beside USER_REPOSITORY because it is a rule about the user row.
    // Chapter onboarding, invite redemption and the user controller all
    // import AuthModule already, and all three inject it (#2302).
    LegalAcceptanceService,
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
  ],
  exports: [AuthService, LegalAcceptanceService, USER_REPOSITORY],
})
export class AuthModule {}
