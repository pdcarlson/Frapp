import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CATALOG } from '@repo/org-archetypes';
import { assertContentFreeProperties } from '@repo/validation';
import {
  FEATURE_EVENTS,
  type FeatureEventName,
} from '#domain/constants/feature-events';
import { featureEventsOf } from '../decorators/feature-event.decorator';
import { REQUIRED_MODULE_KEY } from '../decorators/module.decorator';

/**
 * The feature-event catalog (#593) against its three other statements: the
 * `@FeatureEvent` handlers that send it, the shared analytics hygiene rules,
 * and `spec/behavior/observability.md` § Feature Events.
 */

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const NAMES = Object.keys(FEATURE_EVENTS) as FeatureEventName[];

interface DecoratedHandler {
  names: FeatureEventName[];
  /** The route's `@RequireModule` key, handler over class, if any. */
  module: string | undefined;
}

/** Every controller handler's `@FeatureEvent`s, as `Controller.method → …`. */
async function decoratedHandlers(): Promise<Map<string, DecoratedHandler>> {
  const found = new Map<string, DecoratedHandler>();
  const files = readdirSync(__dirname).filter(
    (file) => file.endsWith('.controller.ts') && !file.endsWith('.spec.ts'),
  );
  for (const file of files) {
    const exports = (await import(join(__dirname, file))) as Record<
      string,
      unknown
    >;
    for (const exported of Object.values(exports)) {
      if (typeof exported !== 'function') continue;
      const proto = (exported as { prototype?: object }).prototype;
      if (!proto) continue;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') continue;
        const handler: unknown = Object.getOwnPropertyDescriptor(
          proto,
          key,
        )?.value;
        const names = featureEventsOf(handler).map((event) => event.name);
        if (names.length === 0) continue;
        const module =
          (Reflect.getMetadata(REQUIRED_MODULE_KEY, handler as object) as
            string | undefined) ??
          (Reflect.getMetadata(REQUIRED_MODULE_KEY, exported) as
            string | undefined);
        found.set(`${exported.name}.${key}`, { names, module });
      }
    }
  }
  return found;
}

/** `| \`name\` | … | \`a\`, \`b\` |` rows of the spec's Feature Events tables. */
function specRows(): Map<string, string[]> {
  const doc = readFileSync(
    join(__dirname, '../../../../../spec/behavior/observability.md'),
    'utf8',
  );
  const start = doc.indexOf('\n## Feature Events');
  expect(start).toBeGreaterThan(-1);
  const end = doc.indexOf('\n## ', start + 1);
  const section = doc.slice(start, end === -1 ? undefined : end);
  const rows = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const name = /^`([a-z0-9-]+)`$/.exec(cells[1] ?? '')?.[1];
    if (!name) continue;
    const properties = [...(cells.at(-2) ?? '').matchAll(/`([a-z0-9_]+)`/g)]
      .map((match) => match[1])
      .sort();
    rows.set(name, properties);
  }
  return rows;
}

describe('feature events (#593)', () => {
  it('names every event in kebab-case, the shape the analytics endpoint accepts', () => {
    for (const name of NAMES) expect(name).toMatch(KEBAB);
  });

  it('names a real module as each feature', () => {
    const modules = new Set(MODULE_CATALOG.map((entry) => entry.key));
    for (const name of NAMES) {
      expect({
        name,
        known: modules.has(FEATURE_EVENTS[name].feature),
      }).toEqual({ name, known: true });
    }
  });

  it('allows only snake_case, content-free, unreserved property keys', () => {
    for (const name of NAMES) {
      const keys: readonly string[] = FEATURE_EVENTS[name].properties;
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys).not.toContain('feature');
      for (const key of keys) expect(key).toMatch(SNAKE);
      const sample = Object.fromEntries(keys.map((key) => [key, true]));
      expect(() =>
        assertContentFreeProperties({
          name,
          properties: { ...sample, feature: FEATURE_EVENTS[name].feature },
        }),
      ).not.toThrow();
    }
  });

  it('is sent by at least one handler each, and no handler sends an event outside it', async () => {
    const handlers = await decoratedHandlers();
    const sent = new Set([...handlers.values()].flatMap((h) => h.names));
    expect([...sent].filter((name) => !(name in FEATURE_EVENTS))).toEqual([]);
    expect(NAMES.filter((name) => !sent.has(name))).toEqual([]);
  });

  it("names the route's own module as the feature, where the route is gated by one", async () => {
    const mismatched = [...(await decoratedHandlers())].flatMap(
      ([handler, { names, module }]) =>
        module === undefined
          ? []
          : names
              .filter((name) => FEATURE_EVENTS[name].feature !== module)
              .map(
                (name) =>
                  `${handler}: ${name} is ${FEATURE_EVENTS[name].feature}, route is ${module}`,
              ),
    );
    expect(mismatched).toEqual([]);
  });

  it('sends nothing from the config PATCH, which can flip the opt-out ChapterGuard already read', async () => {
    // The interceptor passes the guard's pre-handler `analytics_opt_out` to
    // `track`. On the one route that writes that flag, the value would be
    // stale: a request opting the chapter out would still send its event.
    const handlers = await decoratedHandlers();
    expect(handlers.has('ChapterConfigController.patchConfig')).toBe(false);
  });

  it('matches the spec: the same events, each with the same properties', () => {
    const rows = specRows();
    expect([...rows.keys()].sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      expect({ name, properties: rows.get(name) }).toEqual({
        name,
        properties: [...FEATURE_EVENTS[name].properties].sort(),
      });
    }
  });
});
