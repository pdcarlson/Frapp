import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerOptions } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : req.ip;
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
    throttler: ThrottlerOptions,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ method: string }>();
    const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

    // Only apply the 'write' throttler to write methods
    if (throttler.name === 'write' && !isWriteMethod) {
      return true; // Skip throttling
    }

    // Only apply the 'read' throttler to read methods (GET, OPTIONS, HEAD)
    if (throttler.name === 'read' && isWriteMethod) {
      return true; // Skip throttling
    }

    return super.handleRequest(context, limit, ttl, throttler);
  }
}
