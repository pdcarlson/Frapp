import { Module } from '@nestjs/common';
import { ChapterGuard } from '../../interface/guards/chapter.guard';
import { OnboardingController } from '../../interface/controllers/onboarding.controller';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OnboardingController],
  providers: [ChapterGuard, ChapterOnboardingService],
  exports: [ChapterGuard, ChapterOnboardingService],
})
export class ChapterModule {}
