import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join } from 'path';
import { getMetadataStorage, ValidationTypes } from 'class-validator';

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

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.dto.ts') || file.endsWith('.spec.ts')) continue;
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
    // this suite vacuously pass with nothing to check.
    expect(classes.length).toBeGreaterThan(30);
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

  it('the privileged-value fields keep their bounds', () => {
    // These are the specific properties #849 called out as server-decided or
    // money-shaped. Asserting them by name means a later "cleanup" that drops a
    // bound has to delete a test that says why the bound is there.
    const expectations: Array<[string, string, string[]]> = [
      ['AdjustPointsDto', 'amount', ['min', 'max']],
      ['AdjustPointsDto', 'target_user_id', ['isUuid']],
      ['CreateFinancialInvoiceDto', 'amount', ['min', 'max']],
      ['UpdateFinancialInvoiceDto', 'amount', ['min', 'max']],
      ['TransferPresidencyDto', 'target_member_id', ['isUuid']],
      ['SendMessageDto', 'metadata', ['isObject']],
    ];

    const missing: string[] = [];

    for (const [className, prop, required] of expectations) {
      const cls = classes.find((c) => c.name === className);
      if (!cls) {
        missing.push(`${className} (class not found)`);
        continue;
      }
      const names = (constraintsByProperty(cls).get(prop) ?? []).map(
        (v) => v.name,
      );
      for (const req of required) {
        if (!names.includes(req)) missing.push(`${className}.${prop}: @${req}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
