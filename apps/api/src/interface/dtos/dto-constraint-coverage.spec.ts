import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage, validate, ValidationTypes } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * Criterion 1 of #849 asked for "a DTO audit table (or lint rule) showing every
 * property constrained". This is the lint rule: a table would be accurate the
 * day it was written and wrong by the next PR, whereas this fails in CI the
 * moment coverage regresses.
 *
 * What it actually guards: the global pipe runs `whitelist: true`, so a
 * property carrying *no* decorators is stripped before it reaches a service —
 * harmless. The dangerous shape is a property that carries only a **gate**
 * (`@IsOptional`, `@ValidateIf`, `@Allow`): the gate is enough to survive
 * whitelisting, but nothing then checks the value. `SendMessageDto.metadata`
 * was exactly that, and it reached a DB write untyped.
 *
 * So the invariant is narrow and precise: any property the pipe will let
 * through must have at least one real constraint behind the gate.
 */

/** Decorators that only decide *whether* to validate, never *what* is valid. */
const GATE_ONLY: readonly string[] = [
  ValidationTypes.CONDITIONAL_VALIDATION, // @IsOptional, @ValidateIf
  ValidationTypes.WHITELIST, // @Allow
];

interface DtoClass {
  new (...args: never[]): object;
  name: string;
}

/**
 * Discovered from disk rather than listed by hand: a new `*.dto.ts` is covered
 * the moment it lands, which is the whole point of preferring this to a table.
 */
function loadDtoClasses(): DtoClass[] {
  const dir = __dirname;
  const classes: DtoClass[] = [];

  // Recursive so a reorganisation into `dtos/<domain>/` subfolders keeps every
  // DTO audited. A flat read would quietly stop covering the moved files while
  // still finding enough classes to clear the floor below.
  for (const file of readdirSync(dir, { recursive: true }).map(String).sort()) {
    if (!file.endsWith('.dto.ts')) continue;
    // Synchronous require, as in test/ai-evals/harness/registry.ts: `import()`
    // stays a true dynamic import under ts-jest and would need
    // --experimental-vm-modules on the whole runner for this one file.
    // Extension stripped so Jest's resolver picks the module up normally.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(join(dir, file.replace(/\.ts$/, ''))) as Record<
      string,
      unknown
    >;
    for (const exported of Object.values(mod)) {
      if (
        typeof exported === 'function' &&
        /^\s*class\s/.test(exported.toString())
      ) {
        classes.push(exported as DtoClass);
      }
    }
  }
  return classes;
}

/**
 * Property -> the validators registered on it, for one class.
 *
 * class-validator files every standard decorator under the `customValidation`
 * *type* and keeps the decorator's identity in `name` (`min`, `isUuid`, …), so
 * both fields matter: `type` distinguishes a gate from a constraint, `name`
 * says which constraint it is.
 */
interface RegisteredValidator {
  type: string;
  name: string;
}

function constraintsByProperty(
  cls: DtoClass,
): Map<string, RegisteredValidator[]> {
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(
    cls,
    '',
    false,
    false,
  );
  const byProp = new Map<string, RegisteredValidator[]>();
  for (const m of metadatas) {
    if (!m.propertyName) continue;
    const found = byProp.get(m.propertyName) ?? [];
    found.push({ type: m.type, name: (m as { name?: string }).name ?? m.type });
    byProp.set(m.propertyName, found);
  }
  return byProp;
}

describe('DTO constraint coverage (#849)', () => {
  const classes = loadDtoClasses();

  it('finds the DTO classes to audit', () => {
    // A refactor that moves or renames the DTO directory would otherwise make
    // this suite vacuously pass with nothing to check. The floor sits just
    // under the real count (94 at the time of writing) rather than at a token
    // value, so losing a chunk of the directory fails here instead of silently
    // shrinking what the next test audits.
    expect(classes.length).toBeGreaterThan(80);
  });

  it('no property survives whitelisting with only a gate decorator', () => {
    const offenders: string[] = [];

    for (const cls of classes) {
      for (const [prop, found] of constraintsByProperty(cls)) {
        const hasRealConstraint = found.some(
          (v) => !GATE_ONLY.includes(v.type),
        );
        if (!hasRealConstraint) {
          const only = found.map((v) => `@${v.name}`).join(', ');
          offenders.push(`${cls.name}.${prop} (only: ${only})`);
        }
      }
    }

    // Named in the failure so the fix is obvious without re-running a scan.
    expect(offenders).toEqual([]);
  });

  // [class, property, what makes the value hostile, the value]. The reason
  // comes third because jest fills `%s` positionally — with the value there,
  // four cases were named after 101 literal `x` characters and no case could
  // be selected with `-t`.
  it.each([
    ['AdjustPointsDto', 'amount', 'award above the ceiling', 2_147_483_647],
    ['AdjustPointsDto', 'amount', 'fine below the floor', -2_147_483_648],
    ['AdjustPointsDto', 'target_user_id', 'non-uuid target', 'not-a-uuid'],
    ['AdjustPointsDto', 'reason', 'unbounded reason', 'x'.repeat(501)],
    ['CreateFinancialInvoiceDto', 'amount', 'unpayable amount', 100_000_000],
    ['UpdateFinancialInvoiceDto', 'amount', 'unpayable amount', 100_000_000],
    ['CreateFinancialInvoiceDto', 'title', 'oversized title', 'x'.repeat(256)],
    [
      'ListPointTransactionsQueryDto',
      'user_id',
      'non-uuid filter',
      'not-a-uuid',
    ],
    [
      'TransferPresidencyDto',
      'target_member_id',
      'non-uuid target',
      'not-a-uuid',
    ],
    ['SendMessageDto', 'metadata', 'untyped blob', 'a string, not an object'],
    ['CreateRoleDto', 'name', 'oversized role name', 'x'.repeat(101)],
    ['CreateRoleDto', 'name', 'empty role name', ''],
    ['UpdateRoleDto', 'name', 'oversized role name', 'x'.repeat(101)],
    ['CreateCustomRoleDto', 'label', 'oversized role label', 'x'.repeat(101)],
    ['UpdateCustomRoleDto', 'label', 'oversized role label', 'x'.repeat(101)],
    ['CreateCustomRoleDto', 'key', 'oversized role key', 'x'.repeat(65)],
    // Every path that writes point_transactions.amount, not just the manual one.
    ['CreateEventDto', 'point_value', 'ledger write above the ceiling', 2e9],
    ['UpdateEventDto', 'point_value', 'ledger write above the ceiling', 2e9],
    ['CreateTaskDto', 'point_reward', 'ledger write above the ceiling', 2e9],
    ['ListPollsQueryDto', 'channel_id', 'non-uuid channel', 'not-a-uuid'],
    ['StartStudySessionDto', 'geofence_id', 'non-uuid geofence', 'not-a-uuid'],
  ])('%s.%s rejects an %s', async (className, prop, _why, hostileValue) => {
    // Asserted by *validating a value*, not by naming decorators: composing
    // these bounds into a custom decorator later is a refactor, and a test
    // that failed on that would be measuring the implementation rather than
    // the rule. These are the properties #849 called out as server-decided,
    // money-shaped, or unbounded.
    //
    // `validate` runs with NO whitelist options on purpose. Under
    // `forbidNonWhitelisted` an *undeclared* property yields an error whose
    // `.property` is that same name ("property X should not exist"), so this
    // assertion passed whether the bound existed or not — deleting a decorator,
    // or typo-ing a row, left the whole table green. Without the option a
    // property with no constraints produces no error at all, and the row fails.
    const cls = classes.find((c) => c.name === className);
    expect(cls).toBeDefined();

    const errors = await validate(
      plainToInstance(cls as DtoClass, { [prop]: hostileValue }),
    );

    expect(errors.map((e) => e.property)).toContain(prop);
  });
});
