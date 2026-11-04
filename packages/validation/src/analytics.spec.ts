import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_APPS,
  assertContentFreeProperties,
  CLIENT_ANALYTICS_APPS,
  ContentFreePropertyError,
  RESERVED_ANALYTICS_PROPERTY_KEYS_TEXT,
} from './analytics';

const DISTINCT_ID = 'a'.repeat(64);

function check(properties: Record<string, string | number | boolean | null>) {
  return () =>
    assertContentFreeProperties({
      name: 'search-completed',
      distinctId: DISTINCT_ID,
      properties,
    });
}

describe('assertContentFreeProperties', () => {
  it('passes behavioral scalars through unchanged', () => {
    const event = {
      name: 'search-completed',
      distinctId: DISTINCT_ID,
      properties: { result_count: 3, scope: 'chapter', app_version: '1.2.0' },
    };
    expect(assertContentFreeProperties(event)).toBe(event);
  });

  // The API stamps `app` and passes PostHog's own `$` keys (groups, person
  // processing) itself; an event's properties must not pre-empt either.
  it.each([
    ['app', { app: 'api' }],
    ['$groups', { $groups: 'x' }],
    ['$process_person_profile', { $process_person_profile: true }],
    ['$set', { $set: 'x' }],
  ])('rejects the reserved key %s', (key, properties) => {
    expect(check(properties)).toThrow(ContentFreePropertyError);
    expect(check(properties)).toThrow(`reserved property: ${key}`);
  });

  it('names every reserved key it found', () => {
    expect(check({ app: 'web', $ip: '1.2.3.4', step: 1 })).toThrow(
      'reserved properties: app, $ip',
    );
  });

  it('names the reserved keys from the list, not by hand', () => {
    expect(RESERVED_ANALYTICS_PROPERTY_KEYS_TEXT).toBe('`app`');
    expect(check({ app: 'web' })).toThrow(
      `The API sets ${RESERVED_ANALYTICS_PROPERTY_KEYS_TEXT} itself`,
    );
  });

  // The API checks a payload before it knows whether analytics is configured,
  // so before any distinct id exists.
  it('checks an event that has no distinct id yet', () => {
    expect(() =>
      assertContentFreeProperties({
        name: 'search-completed',
        properties: { $set: 'x' },
      }),
    ).toThrow(ContentFreePropertyError);
  });

  it('reserves `app` exactly, and `$` only as a prefix', () => {
    expect(check({ application: 'x', apps: 2, price$: 3 })).not.toThrow();
  });

  it('still rejects content keys and non-scalar values', () => {
    expect(check({ email: 'x' })).toThrow('forbidden content/PII property');
    expect(() =>
      assertContentFreeProperties({
        name: 'search-completed',
        distinctId: DISTINCT_ID,
        properties: { meta: { body: 'x' } } as never,
      }),
    ).toThrow('non-scalar property');
  });
});

describe('analytics apps', () => {
  it('lets a client name itself as web or mobile, never as the API', () => {
    expect(CLIENT_ANALYTICS_APPS).toEqual(['web', 'mobile']);
    expect(ANALYTICS_APPS).toEqual([...CLIENT_ANALYTICS_APPS, 'api']);
  });
});
