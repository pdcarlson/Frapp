import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { getMetadataStorage, type ValidationError } from 'class-validator';
import { loadDtoClasses, type DtoClass } from '#test/helpers/dto-corpus';
import { VALIDATION_PIPE_OPTIONS } from '../pipes/validation-pipe.options';

/**
 * Every boolean DTO field takes only a JSON `true` or `false` (#2612).
 *
 * The production pipe's `enableImplicitConversion` turns a `boolean`-typed
 * field's `"false"` into `true`, and a bare `@IsBoolean()` then passes it: a
 * hand-written `{"is_mandatory":"false"}` marked an event mandatory. The fix is
 * `@IsStrictBoolean()`; this guard finds every `isBoolean` property by its
 * validation metadata, so a new field written with a bare `@IsBoolean()` fails
 * here without anyone listing it.
 */

/** Every property carrying an `isBoolean` validator, as `[class, property]`. */
function booleanFields(classes: DtoClass[]): Array<[DtoClass, string]> {
  const found: Array<[DtoClass, string]> = [];
  for (const cls of classes) {
    const props = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(cls, '', false, false)
        .filter((m) => m.name === 'isBoolean')
        .map((m) => m.propertyName),
    );
    for (const prop of props) found.push([cls, prop]);
  }
  return found;
}

/**
 * The production options, with the 400 swapped for the raw errors so the
 * assertion can name the property and constraint instead of parsing messages.
 */
const pipe = new ValidationPipe({
  ...VALIDATION_PIPE_OPTIONS,
  exceptionFactory: (errors) => errors,
});

/** The constraints that failed on `prop`, or none if the body passed. */
async function failedConstraints(
  cls: DtoClass,
  prop: string,
  value: unknown,
): Promise<string[]> {
  try {
    await pipe.transform({ [prop]: value }, { type: 'body', metatype: cls });
    return [];
  } catch (thrown) {
    const errors = thrown as ValidationError[];
    return Object.keys(
      errors.find((e) => e.property === prop)?.constraints ?? {},
    );
  }
}

const fields = booleanFields(loadDtoClasses());
const cases = fields.map(
  ([cls, prop]) => [`${cls.name}.${prop}`, cls, prop] as const,
);

describe('boolean DTO fields take only real booleans (#2612)', () => {
  it('finds the boolean fields to check', () => {
    // A floor, not a pin: 26 at the time of writing. Losing the discovery (a
    // renamed directory, a metadata name that changed) fails here rather than
    // leaving the table below empty and green.
    expect(fields.length).toBeGreaterThanOrEqual(26);
  });

  describe.each(cases)('%s', (_name, cls, prop) => {
    it.each(['false', 'true', '0', '1'])(
      'refuses the string %p',
      async (value) => {
        expect(await failedConstraints(cls, prop, value)).toContain(
          'isBoolean',
        );
      },
    );

    it.each([true, false])('takes %p as a boolean', async (value) => {
      expect(await failedConstraints(cls, prop, value)).not.toContain(
        'isBoolean',
      );
    });
  });
});
