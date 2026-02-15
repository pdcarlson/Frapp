import { Module } from '@nestjs/common';
import { UserService } from '../../application/services/user.service';
import { UserSyncService } from '../../application/services/user-sync.service';
import { DrizzleUserRepository } from '../../infrastructure/database/repositories/drizzle-user.repository';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    UserService,
    UserSyncService,
    {
      provide: USER_REPOSITORY,
      useClass: DrizzleUserRepository,
    },
  ],
  exports: [UserService, UserSyncService],
})
export class UserModule {}
