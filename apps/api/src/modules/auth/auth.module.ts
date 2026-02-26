import { Module } from '@nestjs/common';
import { AuthService } from '../../application/services/auth.service';
import { SupabaseUserRepository } from '../../infrastructure/supabase/repositories/supabase-user.repository';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';

@Module({
  providers: [
    AuthService,
    { provide: USER_REPOSITORY, useClass: SupabaseUserRepository },
  ],
  exports: [AuthService, USER_REPOSITORY],
})
export class AuthModule {}
