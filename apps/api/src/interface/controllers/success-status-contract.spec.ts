import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { DECORATORS } from '@nestjs/swagger';

/**
 * Every route's documented success status is the one Nest sends (#3085).
 *
 * Nest answers a `@Post()` with 201 and every other verb with 200 unless the
 * handler sets `@HttpCode`. `@ApiOkResponse` on a POST without `@HttpCode`
 * therefore puts a 200 in `openapi.json` that the server never sends: eight
 * routes shipped that way, and nothing noticed, because openapi-fetch reads
 * any 2XX body. This reads both facts off the decorators of every controller
 * in this directory, so a new route can't drift either.
 */

type Handler = (...args: unknown[]) => unknown;

function controllerHandlers(): Array<{ name: string; handler: Handler }> {
  const found: Array<{ name: string; handler: Handler }> = [];
  const files = readdirSync(__dirname).filter((file) =>
    file.endsWith('.controller.ts'),
  );
  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- every controller in the directory, without a hand-kept list
    const exported = require(join(__dirname, file)) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function') continue;
      if (Reflect.getMetadata(PATH_METADATA, value) === undefined) continue;
      const proto = (value as { prototype: Record<string, unknown> }).prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const handler = proto[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) {
          continue;
        }
        found.push({
          name: `${value.name}.${key}`,
          handler: handler as Handler,
        });
      }
    }
  }
  return found;
}

/** What Nest sends on success when the handler returns normally. */
function sentStatus(handler: Handler): number {
  const pinned = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as
    number | undefined;
  if (pinned !== undefined) return pinned;
  return Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.POST
    ? 201
    : 200;
}

/** The 2XX statuses the handler's `@Api*Response` decorators document. */
function documentedSuccess(handler: Handler): number[] {
  const responses = (Reflect.getMetadata(DECORATORS.API_RESPONSE, handler) ??
    {}) as Record<string, unknown>;
  return Object.keys(responses)
    .map(Number)
    .filter((status) => status >= 200 && status < 300);
}

describe('documented success status matches the sent one (#3085)', () => {
  const handlers = controllerHandlers();

  it('reads the controllers it guards', () => {
    // A require that silently found nothing would pass every assertion below.
    expect(handlers.length).toBeGreaterThan(100);
    expect(handlers.map((h) => h.name)).toContain('RushController.vote');
  });

  it('documents, for every route that documents a success, the status Nest sends', () => {
    const drift = handlers.flatMap(({ name, handler }) => {
      const documented = documentedSuccess(handler);
      const sent = sentStatus(handler);
      return documented.length > 0 && !documented.includes(sent)
        ? [`${name}: sends ${sent}, documents ${documented.join(', ')}`]
        : [];
    });
    expect(drift).toEqual([]);
  });
});
