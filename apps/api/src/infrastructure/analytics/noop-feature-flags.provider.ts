import { Injectable } from '@nestjs/common';
import type { IFeatureFlagProvider } from '#domain/adapters/feature-flag.interface';

/**
 * Flags fail closed when PostHog is unconfigured. A missing adapter is not
 * an implicit "on" — clients cannot authorize themselves by evaluating a
 * flag, and neither can an unconfigured server.
 */
@Injectable()
export class NoopFeatureFlagProvider implements IFeatureFlagProvider {
  isEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
