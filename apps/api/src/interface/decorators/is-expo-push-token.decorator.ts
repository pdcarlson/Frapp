import { ValidateBy, type ValidationOptions } from 'class-validator';
import Expo from 'expo-server-sdk';

/**
 * A push token Expo can deliver to, as `Expo.isExpoPushToken` decides: the
 * same check the push provider runs before each send
 * (`expo-push.provider.ts`), so a token this accepts is one a send will try.
 * Anything else could never be delivered to, so it is refused at the door
 * rather than stored.
 */
export function IsExpoPushToken(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isExpoPushToken',
      validator: {
        validate: (value: unknown) => Expo.isExpoPushToken(value),
        defaultMessage: () => 'token must be an Expo push token',
      },
    },
    validationOptions,
  );
}
