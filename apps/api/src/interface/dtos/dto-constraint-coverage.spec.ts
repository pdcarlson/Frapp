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

  it.each([
    ['AdjustPointsDto', 'amount', 2_147_483_647, 'award above the ceiling'],
    ['AdjustPointsDto', 'amount', -2_147_483_648, 'fine below the floor'],
    ['AdjustPointsDto', 'target_user_id', 'not-a-uuid', 'non-uuid target'],
    ['CreateFinancialInvoiceDto', 'amount', 100_000_000, 'unpayable amount'],
    ['UpdateFinancialInvoiceDto', 'amount', 100_000_000, 'unpayable amount'],
    [
      'ListPointTransactionsQueryDto',
      'user_id',
      'not-a-uuid',
      'non-uuid filter',
    ],
    [
      'TransferPresidencyDto',
      'target_member_id',
      'not-a-uuid',
      'non-uuid target',
    ],
    ['SendMessageDto', 'metadata', 'a string, not an object', 'untyped blob'],
    ['CreateRoleDto', 'name', 'x'.repeat(101), 'oversized role name'],
    ['UpdateRoleDto', 'name', 'x'.repeat(101), 'oversized role name'],
    ['CreateCustomRoleDto', 'label', 'x'.repeat(101), 'oversized role label'],
    ['UpdateCustomRoleDto', 'label', 'x'.repeat(101), 'oversized role label'],
  ])('%s.%s rejects a %s', async (className, prop, hostileValue, _why) => {
    // Asserted by *validating a value*, not by naming decorators: composing
    // these bounds into a custom decorator later is a refactor, and a test
    // that failed on that would be measuring the implementation rather than
    // the rule. These are the properties #849 called out as server-decided,
    // money-shaped, or unbounded.
    const cls = classes.find((c) => c.name === className);
    expect(cls).toBeDefined();

    const errors = await validate(
      plainToInstance(cls as DtoClass, { [prop]: hostileValue }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map((e) => e.property)).toContain(prop);
  });
});
