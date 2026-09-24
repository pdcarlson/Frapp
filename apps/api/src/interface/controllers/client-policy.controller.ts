import { Controller, Get, Header, Headers } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CLIENT_VERSION_HEADER } from '#domain/constants/client-version';
import { ClientPolicyService } from '../../application/services/client-policy.service';
import { ClientPolicyDto } from '../dtos/client-policy.dto';

/**
 * The minimum-version check the mobile app runs at launch (#2526).
 *
 * No auth guard, deliberately: the app asks before anyone signs in, and a
 * build too old to sign in is exactly the one that must be told. The answer
 * reveals nothing but a store link and whether the caller's own build is
 * still served. The global throttler's read bucket still applies.
 */
@ApiTags('Client policy')
@Controller('client-policy')
export class ClientPolicyController {
  constructor(private readonly clientPolicy: ClientPolicyService) {}

  @Get()
  // The answer depends on a request header, so no shared cache may store it
  // (Render fronts the API with a CDN). Without this, one build's answer could
  // be served to another.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Whether the calling mobile build is still supported',
  })
  // Named exactly as `@Headers()` below reads it: Swagger documents that
  // decorator as a required header of its own, and only a matching name
  // merges the two into one optional parameter.
  @ApiHeader({
    name: CLIENT_VERSION_HEADER,
    required: false,
    description:
      'The calling build, as `<ios|android>/<version>+<build>` (for example `ios/0.9.0+12`). Mobile sends it on every request.',
  })
  @ApiOkResponse({ type: ClientPolicyDto })
  get(@Headers(CLIENT_VERSION_HEADER) clientVersion?: string): ClientPolicyDto {
    const policy = this.clientPolicy.resolve(clientVersion);
    return {
      update_required: policy.updateRequired,
      update_url: policy.updateUrl,
    };
  }
}
