/**
 * The device's registered push token, and where its server row id is kept.
 *
 * Storage and narrowing only — no network, no React. `use-push-runtime.ts` owns
 * the orchestration; this is the part that has to be right about a detail the
 * API forces on us.
 *
 * ## Why the row id has to be persisted
 *
 * `spec/ui/mobile/patterns.md` § Push notifications: "Register the push token on
 * sign-in, deregister it on sign-out; a token MUST NOT outlive the session that
 * created it." Deregistration is `DELETE /v1/push-tokens/{id}` — **by row id, not
 * by token value**. There is no delete-by-token route
 * (`apps/api/src/interface/controllers/notification.controller.ts`), and the
 * device cannot re-derive the id: `GET /v1/push-tokens` does not exist either.
 * So the id returned at registration is the only handle on the row, and losing
 * it means the row survives the session it belonged to.
 *
 * ## The id arrives untyped
 *
 * `POST /v1/push-tokens` is declared in `openapi.json` with no response schema,
 * so `openapi-typescript` infers its 201 body as `never` and the generated
 * client hands back something no property access compiles against — the same
 * wall `lib/more/narrow.ts` documents for every member-facing read. The server
 * genuinely returns the `push_tokens` row (`NotificationService.registerPushToken`
 * returns it), so the fix is to narrow at the boundary rather than to cast.
 * Adding `@ApiResponse` upstream would be better and is filed as a follow-up;
 * it is not worth dragging the contract-drift gate into a screen slice for one
 * field.
 *
 * A row that cannot be narrowed is treated as "registered, id unknown": push
 * still works, and the next sign-out simply has nothing to delete. That is a
 * leaked row, not a broken app, so it is logged rather than surfaced.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRecord, str } from "../more/narrow";

/** Where the registered row lives between launches. */
export const PUSH_TOKEN_STORAGE_KEY = "frapp.mobile.push-token-row";

export interface PushTokenRow {
  /** `null` when the register response could not be narrowed. */
  id: string | null;
  token: string;
}

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;

/** The `push_tokens` row out of an untyped register response. */
export function narrowPushTokenRow(data: unknown): PushTokenRow | null {
  if (!isRecord(data)) return null;
  const token = str(data, "token");
  if (!token) return null;
  return { id: str(data, "id"), token };
}

export function parseStoredPushTokenRow(value: unknown): PushTokenRow | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    return narrowPushTokenRow(JSON.parse(value) as unknown);
  } catch {
    // A corrupt entry is indistinguishable from none. Re-registering is cheap
    // and idempotent server-side; guessing at half-parsed JSON is not.
    return null;
  }
}

export async function readStoredPushTokenRow(
  storage: Storage = AsyncStorage,
): Promise<PushTokenRow | null> {
  try {
    return parseStoredPushTokenRow(
      await storage.getItem(PUSH_TOKEN_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

export async function writeStoredPushTokenRow(
  row: PushTokenRow,
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.setItem(PUSH_TOKEN_STORAGE_KEY, JSON.stringify(row));
  } catch {
    // Same rationale as `auth-token.ts`: a failed write must never fail the
    // sign-in that triggered it. The cost is one orphaned row server-side.
  }
}

export async function clearStoredPushTokenRow(
  storage: Storage = AsyncStorage,
): Promise<void> {
  try {
    await storage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // Sign-out must never appear to fail.
  }
}

/**
 * Whether a freshly read device token still matches what is registered.
 *
 * Re-registering an identical token is an idempotent no-op server-side, so this
 * is an optimization rather than a correctness gate — but it also avoids
 * discarding a known-good row id for a response we might not be able to narrow.
 */
export function isAlreadyRegistered(
  stored: PushTokenRow | null,
  token: string,
): boolean {
  return !!stored && stored.token === token && stored.id !== null;
}
