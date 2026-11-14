import { randomClientId } from "./random-id";

/**
 * The request-correlation header. Its own module, not `./client`'s, so the
 * middleware `./client` installs (`./first-screen-batch`) can mint one without
 * importing the client back.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Opaque request-correlation id. Not a Sentry/OTEL trace id, not a credential.
 *
 * Minted through {@link randomClientId}, never a bare `crypto.randomUUID()`:
 * React Native has no `crypto` global (`./random-id.ts`, #937).
 */
export const mintRequestId = (): string => `req_${randomClientId()}`;
