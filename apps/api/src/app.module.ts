import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleModule } from './drizzle/drizzle.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
