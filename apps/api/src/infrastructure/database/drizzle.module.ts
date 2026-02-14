import { Module, Global } from '@nestjs/common';
import { DrizzleProvider } from './drizzle.provider';
import { DrizzleUserRepository } from './repositories/drizzle-user.repository';
import { DrizzleChapterRepository } from './repositories/drizzle-chapter.repository';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';

@Global()
@Module({
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
  ],
  exports: [DrizzleProvider, USER_REPOSITORY, CHAPTER_REPOSITORY],
})
export class DrizzleModule {}
