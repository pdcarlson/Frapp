import type { NotificationsModule } from "./push-types";

/** The iOS/Android half of the split — see `push-module.ts` for why it exists. */
export function requireNotifications(): NotificationsModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-notifications") as NotificationsModule;
}
