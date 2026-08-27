/**
 * Web build of the SecureStore seam — **off unless a local build opts in.**
 *
 * ## Why this file exists
 *
 * `expo-secure-store` has no web implementation: its web entry point is
 * literally `export default {}`
 * (`node_modules/expo-secure-store/build/ExpoSecureStore.web.js`), so every
 * `getItemAsync` call throws `TypeError: … is not a function`. Both callers
 * catch and read that as "no value", which means a react-native-web build can
 * sign in and then immediately forget: the Supabase session never persists and
 * the API token never reaches `frapp-client.tsx`, so every authenticated call
 * 401s and the app bounces back to `/sign-in`.
 *
 * That is what kept `scripts/demo/capture-mobile.mjs` from photographing any
 * signed-in screen off the real app, and why it fell back to the committed
 * design board for those surfaces. With this seam and the flag below set, the
 * running app renders its own signed-in screens against a seeded local stack.
 *
 * ## Default off, and strictly so
 *
 * Only the exact string `"1"` switches persistence on; unset, empty, `"0"`,
 * `"true"`, anything else leaves this module behaving exactly as the stub does
 * today — it delegates to `expo-secure-store` and lets the same `TypeError`
 * reach the same catch. The strictness follows `lib/ask/flag.ts`: when the
 * parse is ambiguous the safe answer is off.
 *
 * Off is the safe answer because `localStorage` is not secure storage. It is
 * readable by any script on the origin and survives until it is cleared, so a
 * session parked there is a session any XSS on that origin can lift. That trade
 * is acceptable for `localhost` holding a seeded demo chapter and nothing else.
 * It is not acceptable anywhere a real member signs in, which is why this must
 * never be set for a hosted build.
 *
 * Nothing ships mobile-web today — `eas.json` builds native only, and neither
 * `render.yaml` nor an `apps/mobile/vercel.json` serves it — so the flag has no
 * deployed surface to be switched on for. Keep it that way: if mobile-web ever
 * does ship, this file needs a real web credential store, not this flag.
 *
 * ## The read must stay static
 *
 * `process.env.EXPO_PUBLIC_WEB_SECURE_STORE` is written out longhand for the
 * reason `lib/ask/flag.ts` documents at length: `babel-preset-expo`'s
 * inline-env-vars plugin only rewrites a member expression whose property name
 * literally starts with `EXPO_PUBLIC_`, so a computed lookup is left untouched
 * and reads `undefined` in the bundle no matter what the build set.
 */
import * as SecureStore from "expo-secure-store";

/** The single variable that governs web persistence. Named for the specs. */
export const WEB_SECURE_STORE_ENV_KEY = "EXPO_PUBLIC_WEB_SECURE_STORE";

/** Namespaced so a demo capture cannot collide with anything else on the origin. */
const PREFIX = "frapp.mobile.secure-store:";

function isEnabled(): boolean {
  return process.env.EXPO_PUBLIC_WEB_SECURE_STORE === "1";
}

/**
 * The backing store, or `null` when there isn't one.
 *
 * `output: "static"` in `app.json` means Expo prerenders these routes in Node,
 * where `window` does not exist; and a browser with site data blocked throws on
 * the `localStorage` *getter* rather than returning null. Both have to read as
 * "no store" instead of taking down the module.
 */
function store(): Storage | null {
  if (!isEnabled()) return null;
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  const backing = store();
  // Delegating reproduces today's behaviour exactly, TypeError included, rather
  // than inventing a quieter failure the callers have not been written against.
  if (!backing) return SecureStore.getItemAsync(key);
  return backing.getItem(PREFIX + key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  const backing = store();
  if (!backing) return SecureStore.setItemAsync(key, value);
  backing.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  const backing = store();
  if (!backing) return SecureStore.deleteItemAsync(key);
  backing.removeItem(PREFIX + key);
}
