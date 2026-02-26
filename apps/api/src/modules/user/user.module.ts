import { Module } from '@nestjs/common';
import { UserService } from '../../application/services/user.service';
import { UserController } from '../../interface/controllers/user.controller';
import { AuthSyncInterceptor } from '../../interface/interceptors/auth-sync.interceptor';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UserController],
  providers: [UserService, AuthSyncInterceptor],
  exports: [UserService],
})
export class UserModule {}
