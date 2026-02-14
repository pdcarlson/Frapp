import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AppService } from './app.service';
import { ClerkAuthGuard } from './auth/guards/clerk-auth.guard';
import { ChapterGuard } from './auth/guards/chapter.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('protected')
  @UseGuards(ClerkAuthGuard)
  getProtected(@Request() req): string {
    return `Hello ${req.user.sub}, you are authenticated!`;
  }

  @Get('chapter-protected')
  @UseGuards(ClerkAuthGuard, ChapterGuard)
  getChapterProtected(): string {
    return 'You have access to this chapter!';
  }
}
