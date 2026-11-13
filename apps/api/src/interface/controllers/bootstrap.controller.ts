import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BootstrapService,
  type BootstrapSections,
} from '../../application/services/bootstrap.service';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CurrentChapterId,
  CurrentUser,
} from '../decorators/current-user.decorator';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { BootstrapDto, BootstrapQueryDto } from '../dtos/bootstrap.dto';

/**
 * One request for a client's first screen (#4709). See `BootstrapService` for
 * why it exists and what each section is.
 *
 * Guard chain: `members:view` in the caller's chapter, the floor of every
 * route a section stands in for (chat, the chapter's member view, the inbox),
 * so the response holds nothing the caller couldn't read route by route. The
 * user-only routes it covers (`/users/me` and its siblings, `/chapters`,
 * `/settings`) need less, and a caller with no chapter never asks: the clients
 * read those on their own routes until a chapter is active. The guards still
 * run per request (#3752); this route only makes an open one request.
 *
 * `AuthSyncInterceptor` because `/users/me` and `/chapters` carry it: an open
 * may be the first request after a profile change at the identity provider.
 */
@ApiTags('Bootstrap')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard, ChapterGuard, PermissionsGuard)
@RequirePermissions(SystemPermissions.MEMBERS_VIEW)
@UseInterceptors(AuthSyncInterceptor)
@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly bootstrap: BootstrapService) {}

  @Get()
  @ApiOperation({
    summary: "What a client's first screen reads, in one request",
    description:
      "The reads a client's first screen makes (the user, chapters, permissions, settings, legal acceptance, What's new, channels and their unread counts, categories, notification levels, mention roles, sidebar, blocks, default background, GIF availability, roster and the first inbox page), in one request (#4709). Each section is exactly the body of the route it names, `null` when that read failed, and absent when `include` left it out; read such a section from its own route.",
  })
  @ApiOkResponse({ type: BootstrapDto })
  async getBootstrap(
    @CurrentUser('id') userId: string,
    @CurrentChapterId() chapterId: string,
    @Query() query: BootstrapQueryDto,
  ): Promise<BootstrapSections> {
    return this.bootstrap.load(userId, chapterId, query.include);
  }
}
