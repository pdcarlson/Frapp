import { Module, Global } from '@nestjs/common';
import { DrizzleModule } from '../../infrastructure/database/drizzle.module';

@Global()
@Module({
  imports: [DrizzleModule],
  exports: [DrizzleModule],
})
export class DatabaseModule {}
