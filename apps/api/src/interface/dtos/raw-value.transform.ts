import { Transform } from 'class-transformer';

/**
 * Hands a field to its validators exactly as the client sent it, undoing
 * `enableImplicitConversion` (`validation-pipe.options.ts`) for that one field.
 *
 * Implicit conversion turns a `boolean`-typed field's `"false"` into `true`
 * (`Boolean("false")`), so without this `@IsBoolean() @Equals(true)` accepts a
 * request that said no. Put it on any field whose `true` is recorded as
 * someone's consent (`accept_terms_privacy`, #2302, and the Discord import's
 * `consent_acknowledged`): with the raw value, `@IsBoolean()` rejects every
 * string.
 */
export const RawValue = (): PropertyDecorator =>
  Transform(({ obj, key }) => (obj as Record<string, unknown>)[key]);
