/**
 * The header both clients send on every request with their device's or
 * browser's zone (`@repo/api-sdk` sets it). The API records it per member so a
 * push can name a time the way the member's phone would
 * (`TimeZoneSyncService`, `spec/behavior/notifications.md` § What a push says).
 * Defined once in `@repo/validation`, which the SDK reads too.
 */
export { TIME_ZONE_HEADER } from '@repo/validation';
