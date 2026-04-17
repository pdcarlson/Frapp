import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';
import { isBooleanQueryStringValue } from '../utils/query-boolean';

export const IS_BOOLEAN_QUERY_STRING = 'isBooleanQueryString';

/**
 * Validates optional query booleans as the literal strings `true`, `false`, `1`, or `0`
 * (same set as {@link parseBooleanQueryParam} and OpenAPI enums on affected routes).
 */
export function IsBooleanQueryString(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_BOOLEAN_QUERY_STRING,
      validator: {
        validate: (value: unknown): boolean => isBooleanQueryStringValue(value),
        defaultMessage: buildMessage(
          (eachPrefix) => eachPrefix + '$property must be true, false, 1, or 0',
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
