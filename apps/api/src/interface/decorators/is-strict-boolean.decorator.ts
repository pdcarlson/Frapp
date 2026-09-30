import { Transform } from 'class-transformer';
import { IsBoolean, type ValidationOptions } from 'class-validator';

/**
 * A body boolean that takes only a JSON `true` or `false`. Use it in place of
 * a bare `@IsBoolean()` on every DTO field; `boolean-dto-fields.spec.ts` fails
 * on any `isBoolean` property that still accepts a string.
 *
 * The global pipe's `enableImplicitConversion` (`validation-pipe.options.ts`)
 * converts a `boolean`-typed property with `Boolean(value)`, so `"false"`,
 * `"0"` and every other non-empty string arrive as `true` and pass a bare
 * `@IsBoolean()` (#2612). The transform here hands the validator the value
 * exactly as the client sent it, so every string is refused with a 400.
 *
 * Query booleans are strings by nature and use `@IsBooleanQueryString()`.
 */
export function IsStrictBoolean(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  const raw = Transform(
    ({ obj, key }) => (obj as Record<string, unknown>)[key],
  );
  const isBoolean = IsBoolean(validationOptions);
  return (target, propertyKey) => {
    raw(target, propertyKey);
    isBoolean(target, propertyKey);
  };
}
