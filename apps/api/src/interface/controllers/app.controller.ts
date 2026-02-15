import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AppService } from '../../application/services/app.service';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import type { RequestWithUser } from '../auth.types';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('general')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Get hello world' })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('protected')
  @UseGuards(ClerkAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Authenticated route example' })
  getProtected(@Request() req: RequestWithUser): string {
    return `Hello ${req.user.sub}, you are authenticated!`;
  }

  @Get('chapter-protected')
  @UseGuards(ClerkAuthGuard, ChapterGuard)
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-chapter-id', description: 'Chapter UUID' })
  @ApiOperation({ summary: 'Chapter-specific protected route example' })
  getChapterProtected(): string {
    return 'You have access to this chapter!';
  }

  @Get('health')
  @ApiOperation({ summary: 'API Health check' })
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
