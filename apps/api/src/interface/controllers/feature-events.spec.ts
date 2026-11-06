import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CATALOG } from '@repo/org-archetypes';
import { assertContentFreeProperties } from '@repo/validation';
import {
  FEATURE_EVENTS,
  type FeatureEventName,
} from '#domain/constants/feature-events';
import { decoratedHandlers } from '#test/helpers/feature-event-handlers';

/**
 * The feature-event catalog (#593) against its other statements: the
 * `@FeatureEvent` handlers that send it, the shared analytics hygiene rules,
 * the module catalog, and `spec/behavior/observability.md` § Feature Events.
 */

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const NAMES = Object.keys(FEATURE_EVENTS) as FeatureEventName[];

/**
 * The table rows of one `###` subsection of the spec's § Feature Events, by
 * the backticked key in their first cell, each with its last cell.
 */
function specRows(subsection: string): Map<string, string> {
  const doc = readFileSync(
    join(__dirname, '../../../../../spec/behavior/observability.md'),
    'utf8',
  );
  const section = between(doc, '\n## Feature Events\n', '\n## ');
  const part = between(section, `\n### ${subsection}\n`, '\n### ');
  const rows = new Map<string, string>();
  for (const line of part.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    const key = /^`([A-Za-z0-9-]+)`$/.exec(cells[1] ?? '')?.[1];
    if (key) rows.set(key, cells.at(-2) ?? '');
  }
  return rows;
}

/** `text` from `start` to the next `end` after it, or to its end. */
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect({ start, found: from > -1 }).toEqual({ start, found: true });
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to === -1 ? undefined : to);
}

/** The backticked snake_case keys in a catalog row's Properties cell. */
function propertiesIn(cell: string): string[] {
  return [...cell.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]).sort();
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
    const sent = new Set<string>(
      [...handlers.values()].flatMap((h) => h.events.map((e) => e.name)),
    );
    expect([...sent].filter((name) => !(name in FEATURE_EVENTS))).toEqual([]);
    expect(NAMES.filter((name) => !sent.has(name))).toEqual([]);
  });

  it("names the route's own module as the feature, where the route is gated by one", async () => {
    const mismatched = [...(await decoratedHandlers())].flatMap(
      ([handler, { events, module }]) =>
        module === undefined
          ? []
          : events
              .map((event) => event.name)
              .filter((name) => FEATURE_EVENTS[name].feature !== module)
              .map(
                (name) =>
                  `${handler}: ${name} is ${FEATURE_EVENTS[name].feature}, route is ${module}`,
              ),
    );
    expect(mismatched).toEqual([]);
  });

  it('matches the spec: the same events, each with the same properties', () => {
    const rows = specRows('Catalog');
    expect([...rows.keys()].sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) {
      expect({ name, properties: propertiesIn(rows.get(name) ?? '') }).toEqual({
        name,
        properties: [...FEATURE_EVENTS[name].properties].sort(),
      });
    }
  });

  it('gives every module an event, or a reason in the spec why it has none', () => {
    const covered = new Set<string>(
      NAMES.map((name) => FEATURE_EVENTS[name].feature),
    );
    const exempt = specRows('Modules with no event');
    const wrong = MODULE_CATALOG.map((entry) => entry.key).flatMap((key) => {
      if (covered.has(key) && exempt.has(key)) {
        return [`${key} has an event but is listed as having none`];
      }
      if (!covered.has(key) && !exempt.has(key)) {
        return [`${key} has no event and no reason in the spec`];
      }
      if (exempt.has(key) && !exempt.get(key)) return [`${key}: no reason`];
      return [];
    });
    expect(wrong).toEqual([]);
    const modules = new Set(MODULE_CATALOG.map((entry) => entry.key));
    expect([...exempt.keys()].filter((key) => !modules.has(key))).toEqual([]);
  });
});
