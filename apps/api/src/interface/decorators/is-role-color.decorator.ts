import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isPaintableRoleColor, roleColorOrNull } from '@repo/validation';

/** The words a refused role or group color comes back with. */
const ROLE_COLOR_REFUSAL =
  'color must be a role palette color or a custom color that reads on every surface and is not red or gold';

/**
 * A role or group color (#3485, #5784): a palette value, or any custom color
 * that reads at AA on every surface and sits outside the reserved red and gold
 * bands (`isPaintableRoleColor` in `@repo/validation`), the same set every
 * client paints. It is stored in its painted spelling (`roleColorOrNull`): a
 * palette value as listed, a custom one as uppercase `#RRGGBB`. Anything else
 * reaches the check unchanged and is refused. Pair it with `@IsOptional()`,
 * which lets `null` through to clear the color.
 */
export function IsRoleColor(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  const normalize = Transform(
    ({ value }: { value: unknown }) => roleColorOrNull(value) ?? value,
  );
  const check = ValidateBy(
    {
      name: 'isRoleColor',
      validator: {
        validate: (value: unknown) => isPaintableRoleColor(value),
        defaultMessage: () => ROLE_COLOR_REFUSAL,
      },
    },
    validationOptions,
  );
  return (target, propertyKey) => {
    normalize(target, propertyKey);
    check(target, propertyKey);
  };
}

/** The OpenAPI description both role and group color fields carry. */
export const ROLE_COLOR_API_DESCRIPTION =
  'A role palette color (`ROLE_COLOR_PALETTE` in `@repo/validation`), or any custom `#RRGGBB` that reads at WCAG AA on every dark surface and is not red or gold (`isPaintableRoleColor`), in any letter case. A palette color is stored as listed, a custom one in uppercase; any other value is refused (`400`). Null clears the color.';
