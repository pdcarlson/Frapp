import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  featureEventsOf,
  type FeatureEventMetadata,
} from '../../src/interface/decorators/feature-event.decorator';
import { REQUIRED_MODULE_KEY } from '../../src/interface/decorators/module.decorator';

/**
 * Every controller handler that carries a `@FeatureEvent` (#593), found the
 * one way both feature-event specs use, so they can't come to disagree about
 * which handlers there are: `feature-events.spec.ts` checks the catalog
 * against them, and `feature-event-describers.spec.ts` runs their describers.
 */

const CONTROLLERS_DIR = join(__dirname, '../../src/interface/controllers');

export interface DecoratedHandler {
  /** `Controller.method`. */
  key: string;
  events: readonly FeatureEventMetadata[];
  /** The route's `@RequireModule` key, handler over class, if any. */
  module: string | undefined;
}

/** Every decorated handler in `src/interface/controllers`, by `Controller.method`. */
export async function decoratedHandlers(): Promise<
  Map<string, DecoratedHandler>
> {
  const found = new Map<string, DecoratedHandler>();
  const files = readdirSync(CONTROLLERS_DIR).filter(
    (file) => file.endsWith('.controller.ts') && !file.endsWith('.spec.ts'),
  );
  for (const file of files) {
    const exports = (await import(join(CONTROLLERS_DIR, file))) as Record<
      string,
      unknown
    >;
    for (const exported of Object.values(exports)) {
      if (typeof exported !== 'function') continue;
      const proto = (exported as { prototype?: object }).prototype;
      if (!proto) continue;
      for (const method of Object.getOwnPropertyNames(proto)) {
        if (method === 'constructor') continue;
        const handler: unknown = Object.getOwnPropertyDescriptor(
          proto,
          method,
        )?.value;
        const events = featureEventsOf(handler);
        if (events.length === 0) continue;
        const module =
          (Reflect.getMetadata(REQUIRED_MODULE_KEY, handler as object) as
            string | undefined) ??
          (Reflect.getMetadata(REQUIRED_MODULE_KEY, exported) as
            string | undefined);
        const key = `${exported.name}.${method}`;
        found.set(key, { key, events, module });
      }
    }
  }
  return found;
}
