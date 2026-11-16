/**
 * Request headers both clients send on every call and the API reads. One
 * definition, so `@repo/api-sdk`, which sets them, and the API, which reads
 * them (`#domain/constants/time-zone-header`, `#domain/constants/client-version`),
 * can't name them differently. Lower-case, as Node exposes request headers.
 */

/**
 * The device's or browser's IANA zone. The API records it per member so a
 * push can name a time the way the member's phone would
 * (`TimeZoneSyncService`, `spec/behavior/notifications.md` § What a push says).
 */
export const TIME_ZONE_HEADER = "x-time-zone";

/**
 * The mobile binary's version, `<platform>/<version>[+<build>]` (#2526); the
 * API's `#domain/constants/client-version` owns its shape and the minimum a
 * deployment still serves. That file keeps its own copy of this literal (the
 * deploy check loads it standalone) and its spec pins the copy to this one.
 */
export const CLIENT_VERSION_HEADER = "x-client-version";
