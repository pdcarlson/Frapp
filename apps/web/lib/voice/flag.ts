/**
 * Voice chat PROTOTYPE (#3866). Development only; never set on a deployed
 * environment.
 *
 * This is a local proof of concept on a branch that is not meant for `main`:
 * plain browser WebRTC between the people in a room (a mesh, no media server),
 * with Supabase Realtime carrying the signalling. It exists to try the shape
 * (join, leave, mute, who is talking, a bar that follows you around the app)
 * before Paul decides on a media provider, cost, and plan.
 *
 * Read statically so Next inlines it at build time, as `NEXT_PUBLIC_*` values
 * must be; off unless the variable is exactly "1".
 */
export const VOICE_PROTOTYPE_ENABLED =
  process.env.NEXT_PUBLIC_VOICE_PROTOTYPE === "1" &&
  process.env.NODE_ENV !== "production";
