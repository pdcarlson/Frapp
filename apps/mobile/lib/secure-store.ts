import * as SecureStore from "expo-secure-store";

/**
 * The one seam every SecureStore read and write in this app goes through.
 *
 * `auth-token.ts` and `lib/supabase.ts` are the only two callers, and both
 * import from here rather than from `expo-secure-store` directly, so that the
 * web build can substitute `secure-store.web.ts` by Metro's platform-extension
 * resolution. On native this file is a pass-through and adds no behaviour.
 *
 * The functions forward at call time rather than re-exporting the bindings.
 * `auth-session.spec.tsx` and `use-notification-preferences-sync.spec.tsx` both
 * `vi.mock("expo-secure-store")` and then swap implementations per test with
 * `mockImplementation`; forwarding keeps those swaps visible here, where a
 * captured `export const getItemAsync = SecureStore.getItemAsync` would freeze
 * whichever implementation existed at import.
 */
export function getItemAsync(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

export function setItemAsync(key: string, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value);
}

export function deleteItemAsync(key: string): Promise<void> {
  return SecureStore.deleteItemAsync(key);
}
