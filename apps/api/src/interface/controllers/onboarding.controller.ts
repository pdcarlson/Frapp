import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { OnboardingInitDto } from '../dtos/onboarding-init.dto';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import type { RequestWithUser } from '../auth.types';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  private readonly logger = new Logger(OnboardingController.name);

  constructor(private readonly onboardingService: ChapterOnboardingService) {}

  @Post('init')
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({ summary: 'Initiate chapter onboarding and payment' })
  @ApiResponse({
    status: 201,
    description: 'Onboarding initiated, returns checkout URL',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async initiate(
    @Body() dto: OnboardingInitDto,
    @Request() req: RequestWithUser,
  ) {
    this.logger.log(
      `User ${req.user.sub} initiating onboarding for ${dto.name}`,
    );
    return this.onboardingService.initiateOnboarding(
      dto,
      req.user.email as string,
    );
  }
}
