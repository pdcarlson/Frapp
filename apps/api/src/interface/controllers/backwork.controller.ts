import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { BackworkService } from '../../application/services/backwork.service';
import { CreateBackworkResourceDto } from '../dtos/backwork.dto';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import type { RequestWithUser } from '../auth.types';

@ApiTags('backwork')
@Controller('backwork')
@UseGuards(ClerkAuthGuard, ChapterGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-chapter-id', required: true })
export class BackworkController {
  constructor(private readonly backworkService: BackworkService) {}

  @Get('upload-url')
  @ApiOperation({ summary: 'Get a presigned S3 URL for uploading a file' })
  async getUploadUrl(
    @Req() req: RequestWithUser,
    @Query('filename') filename: string,
    @Query('contentType') contentType: string,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    return this.backworkService.getUploadUrl(chapterId, filename, contentType);
  }

  @Post()
  @ApiOperation({ summary: 'Save metadata for a newly uploaded resource' })
  async createResource(
    @Req() req: RequestWithUser,
    @Body() dto: CreateBackworkResourceDto,
  ) {
    const chapterId = req.headers['x-chapter-id'] as string;
    // We need the internal user ID, but the guard only provides the clerkId (sub)
    // For now, let's assume we have a way to get it or refactor the guard/request.
    // In a real scenario, we'd lookup the internal user ID from the clerk ID.
    // Since I don't have a user service yet, I'll use a placeholder or add a lookup.

    // TODO: Implement internal userId lookup. For now, we'll use a mock or adjust.
    // Let's assume we can get it from the request if we enhance the guard.
    return this.backworkService.createResource({
      ...dto,
      chapterId,
      uploaderId: '00000000-0000-0000-0000-000000000000', // Placeholder
    });
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Get a presigned S3 URL for downloading a resource',
  })
  async getDownloadUrl(@Param('id') id: string) {
    const url = await this.backworkService.getDownloadUrl(id);
    return { downloadUrl: url };
  }
}
