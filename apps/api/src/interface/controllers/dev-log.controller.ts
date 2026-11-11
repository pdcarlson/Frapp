import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  DevLogService,
  type DevLogPost,
} from '../../application/services/dev-log.service';
import { ThrottleFanOutWrite } from '../decorators/throttle-profiles.decorator';
import { DevLogPostDto, DevLogPostResultDto } from '../dtos/dev-log.dto';
import { DevLogTokenGuard } from '../guards/dev-log-token.guard';

/**
 * The team's Dev log channel (#4145): GitHub Actions tells the team's own
 * chapter what is being worked on and what shipped.
 *
 * No `SupabaseAuthGuard`, deliberately: the caller is a workflow, not a
 * member. `DevLogTokenGuard` is the whole of its auth, and the chapter and
 * channel come from this deployment's configuration, never from the request,
 * so there is no chapter context to check and nothing to read back. The body
 * carries facts only; the service writes the words and the links.
 */
@ApiTags('Integrations')
@Controller('integrations/dev-log')
@UseGuards(DevLogTokenGuard)
export class DevLogController {
  constructor(private readonly devLog: DevLogService) {}

  @Post()
  @HttpCode(200)
  // A token-guessing surface, and each call writes a message to a channel.
  @ThrottleFanOutWrite()
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Post to the team's Dev log channel (GitHub Actions only)",
  })
  @ApiOkResponse({ type: DevLogPostResultDto })
  @ApiUnauthorizedResponse({ description: 'Missing or wrong token.' })
  @ApiNotFoundResponse({
    description:
      'The Dev log is not configured on this deployment, or its channel is gone.',
  })
  async post(@Body() body: DevLogPostDto): Promise<DevLogPostResultDto> {
    // The DTO's per-event `ValidateIf` rules guarantee each event's own
    // required fields; this is the one place that narrowing is asserted.
    const status = await this.devLog.post(body as DevLogPost);
    return { status };
  }
}
