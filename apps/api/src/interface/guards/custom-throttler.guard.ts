import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';

const READ_THROTTLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const ips = Array.isArray(req.ips) ? req.ips : [];
    if (ips.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
      return ips[0];
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return req.ip;
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const { context, throttler } = requestProps;
    const request = context.switchToHttp().getRequest<{ method?: string }>();
    const method = request.method?.toUpperCase() ?? '';
    const isReadMethod = READ_THROTTLE_METHODS.has(method);

    if (throttler.name === 'write' && isReadMethod) {
      return true;
    }

    if (throttler.name === 'read' && !isReadMethod) {
      return true;
    }

    return super.handleRequest(requestProps);
  }
}
