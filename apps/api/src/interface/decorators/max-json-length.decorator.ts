import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { jsonLength } from '#domain/utils/json-length';

/**
 * Caps a free-form JSON body field (an object stored as `jsonb`) at `max`
 * characters once serialized ({@link jsonLength}). `@IsObject` checks only
 * the top level's type, so without this a field like a message's `metadata`
 * was bounded only by the body parser's 1 MB limit, and every reader of the
 * channel downloads what is stored there. `undefined` and `null` pass; pair
 * it with `@IsOptional`.
 */
export function MaxJsonLength(
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'maxJsonLength',
      target: target.constructor,
      propertyName: propertyKey as string,
      constraints: [max],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === undefined || value === null) return true;
          return jsonLength(value) <= (args.constraints[0] as number);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} is too large: at most ${String(args.constraints[0])} characters`;
        },
      },
    });
  };
}
