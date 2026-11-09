import {
  CHAT_DENSITY_STORAGE_KEY,
  DEFAULT_CHAT_DENSITY,
  parseChatDensity,
  type ChatDensity,
} from "@repo/chat-core/density";
import { createStoredPreference } from "@/lib/stored-preference";

/**
 * The member's chat density on this phone (`@repo/chat-core/density`).
 *
 * AsyncStorage, read once per app process and held in memory after that, so
 * every row in a long thread reads a module variable rather than storage. The
 * read starts when this module loads. In a release build route modules load
 * when first rendered, so that is when the thread or Settings first opens; a
 * cold start straight into a thread can draw cozy for the frame or two before
 * the read lands, then redraw compact. Best-effort both ways: a storage error
 * reads as cozy, and a failed write keeps the choice until the app restarts.
 */
const preference = createStoredPreference<ChatDensity>({
  key: CHAT_DENSITY_STORAGE_KEY,
  parse: parseChatDensity,
  fallback: DEFAULT_CHAT_DENSITY,
});

/** Reads the stored choice once; a choice made before the read lands wins. */
export const hydrateChatDensity = preference.hydrate;

void hydrateChatDensity();

export const useChatDensity = preference.use;
export const setChatDensity = preference.set;

/** Test seam: back to a fresh process. */
export const resetChatDensityForTests = preference.resetForTests;
