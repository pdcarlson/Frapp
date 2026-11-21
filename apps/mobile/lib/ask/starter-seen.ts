import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AskStarterStore } from "@repo/hooks";
import type { AskStarterSeen } from "@repo/validation";

/**
 * Where the phone remembers that a member has seen Ask's first-open starter
 * (#4904; Paul, 2026-11-17): per member, so a second account on the same
 * phone gets its own first open. When the record is read and written, and what it
 * decides, is `useAskStarter` in `@repo/hooks`, shared with web.
 */

const STORAGE_KEY_PREFIX = "frapp.mobile.ask-starter-seen:";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

function parse(raw: string | null): AskStarterSeen | null {
  return raw === "ask" || raw === "act" ? raw : null;
}

export function askStarterStore(
  storage: Storage = AsyncStorage,
): AskStarterStore {
  return {
    read: async (userId) => {
      try {
        return parse(await storage.getItem(STORAGE_KEY_PREFIX + userId));
      } catch {
        return undefined;
      }
    },
    write: async (userId, seen) => {
      try {
        await storage.setItem(STORAGE_KEY_PREFIX + userId, seen);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** The phone's store, one for the app. */
export const ASK_STARTER_STORE = askStarterStore();
