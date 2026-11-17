import { Transform } from 'class-transformer';

/**
 * Trims a string field before it is validated, so the length checks after it
 * count what is stored, and spaces alone read as blank. Anything that isn't a
 * string passes through for the field's type check to refuse.
 */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
