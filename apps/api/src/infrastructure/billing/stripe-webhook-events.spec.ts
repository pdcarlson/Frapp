import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HANDLED_WEBHOOK_EVENT_TYPES } from './stripe-webhook-events';
import { STRIPE_WEBHOOK_PATH } from './stripe-webhook-consistency';

const SRC = join(__dirname, '..', '..');

/**
 * Two invariants that used to hold by adjacency and now do not.
 *
 * `HANDLED_WEBHOOK_EVENT_TYPES` moved out of `billing.service.ts` so the boot
 * check could read it without importing the service. That is the right shape,
 * but it puts the set and the `switch` it must agree with in different layers,
 * ~330 lines apart — and the `default:` branch logs and then falls through to
 * `markProcessed`, so the event is claimed, dropped, and acked 2xx. Stripe
 * never retries it. A type added to the set without a matching `case` is a
 * permanently lost subscription or payment event, with one error line.
 */
describe('HANDLED_WEBHOOK_EVENT_TYPES ↔ handleWebhookEvent switch', () => {
  it('has a `case` in billing.service.ts for every handled type', () => {
    const source = readFileSync(
      join(SRC, 'application', 'services', 'billing.service.ts'),
      'utf8',
    );
    const cases = new Set(
      [...source.matchAll(/case\s+'([a-z_]+\.[a-z_.]+)':/g)].map((m) => m[1]),
    );
    const missing = [...HANDLED_WEBHOOK_EVENT_TYPES]
      .filter((type) => !cases.has(type))
      .sort();
    expect(missing).toEqual([]);
  });

  it('handles no type it does not also declare', () => {
    // The other direction: a `case` with no entry in the set is unreachable,
    // because the type is dropped before the switch is ever entered.
    const source = readFileSync(
      join(SRC, 'application', 'services', 'billing.service.ts'),
      'utf8',
    );
    const cases = [...source.matchAll(/case\s+'([a-z_]+\.[a-z_.]+)':/g)].map(
      (m) => m[1],
    );
    const undeclared = cases
      .filter((type) => !HANDLED_WEBHOOK_EVENT_TYPES.has(type))
      .sort();
    expect(undeclared).toEqual([]);
  });
});

/**
 * `STRIPE_WEBHOOK_PATH` is a hand-written mirror of a route composed from three
 * places. Every other assertion about it interpolates the constant on both
 * sides of the comparison, so it validates against itself and cannot catch
 * drift — and the guard that uses it is fail-closed, so if the route moves and
 * this constant does not, EVERY deploy is refused at boot by a guard that is
 * itself the stale party, with a message blaming `STRIPE_SECRET_KEY`.
 */
describe('STRIPE_WEBHOOK_PATH mirrors the served route', () => {
  it('matches @Controller + @Post + the global URI version', () => {
    const controller = readFileSync(
      join(SRC, 'interface', 'controllers', 'webhook.controller.ts'),
      'utf8',
    );
    const bootstrap = readFileSync(join(SRC, 'bootstrap.ts'), 'utf8');

    const controllerPath = /@Controller\('([^']+)'\)/.exec(controller)?.[1];
    const postPath = /@Post\('([^']+)'\)/.exec(controller)?.[1];
    const defaultVersion = /defaultVersion:\s*'([^']+)'/.exec(bootstrap)?.[1];

    expect(controllerPath).toBeDefined();
    expect(postPath).toBeDefined();
    expect(defaultVersion).toBeDefined();

    expect(STRIPE_WEBHOOK_PATH).toBe(
      `/v${defaultVersion}/${controllerPath}/${postPath}`,
    );
  });

  it('is not silently invalidated by a global prefix', () => {
    // setGlobalPrefix would insert a segment this constant does not model.
    const bootstrap = readFileSync(join(SRC, 'bootstrap.ts'), 'utf8');
    expect(bootstrap).not.toMatch(/setGlobalPrefix\(/);
  });
});
