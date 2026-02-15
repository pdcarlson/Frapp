import { Module, Global } from '@nestjs/common';
import { DrizzleModule } from '../../infrastructure/database/drizzle.module';
import { DrizzleProvider } from '../../infrastructure/database/drizzle.provider';
import { DrizzleUserRepository } from '../../infrastructure/database/repositories/drizzle-user.repository';
import { DrizzleChapterRepository } from '../../infrastructure/database/repositories/drizzle-chapter.repository';
import { DrizzleInviteRepository } from '../../infrastructure/database/repositories/drizzle-invite.repository';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import { INVITE_REPOSITORY } from '../../domain/repositories/invite.repository.interface';

@Global()
@Module({
  imports: [DrizzleModule],
  providers: [
    DrizzleProvider,
    {
      provide: USER_REPOSITORY,
      useClass: DrizzleUserRepository,
    },
    {
      provide: CHAPTER_REPOSITORY,
      useClass: DrizzleChapterRepository,
    },
    {
      provide: INVITE_REPOSITORY,
      useClass: DrizzleInviteRepository,
    },
  ],
  exports: [
    DrizzleModule,
    USER_REPOSITORY,
    CHAPTER_REPOSITORY,
    INVITE_REPOSITORY,
  ],
})
export class DatabaseModule {}
