import { Module } from '@nestjs/common';
import { AuthService } from '../../application/services/auth.service';
import { LegalAcceptanceService } from '../../application/services/legal-acceptance.service';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { TimeZoneSyncService } from '../../application/services/time-zone-sync.service';
import { SupabaseUserSettingsRepository } from '../../infrastructure/supabase/repositories/supabase-user-settings.repository';
import { USER_SETTINGS_REPOSITORY } from '#domain/repositories/notification.repository.interface';

@Module({
  providers: [
    AuthService,
    // Lives beside USER_REPOSITORY because it is a rule about the user row.
    // Chapter onboarding, invite redemption and the user controller all
    // import AuthModule already, and all three inject it (#2302).
    LegalAcceptanceService,
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
    // Every module that uses `AuthSyncInterceptor` imports this one, and the
    // interceptor records the caller's `x-time-zone` through it.
    TimeZoneSyncService,
    {
      provide: USER_SETTINGS_REPOSITORY,
      useClass: SupabaseUserSettingsRepository,
    },
  ],
  exports: [
    AuthService,
    LegalAcceptanceService,
    USER_REPOSITORY,
    TimeZoneSyncService,
  ],
})
export class AuthModule {}
