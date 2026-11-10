import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CHAT_CHANNEL_DENSITY_STORAGE_KEY,
  CHAT_DENSITY_STORAGE_KEY,
  DEFAULT_CHAT_DENSITY,
  getLockedChannels,
  parseChannelDensityMap,
  parseChatDensity,
  resolveChannelDensity,
  subscribeLockedChannels,
  withChannelDensity,
  type ChannelDensityMap,
  type ChatDensity,
} from "@repo/chat-core/density";

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
let density: ChatDensity = DEFAULT_CHAT_DENSITY;
let hydration: Promise<void> | null = null;
/** Set by a choice made in this process, which the stored read must not undo. */
let chosen = false;
/** Per-channel overrides on this phone (#3787); a channel absent follows `density`. */
const NO_OVERRIDES: ChannelDensityMap = {};
let overrides: ChannelDensityMap = NO_OVERRIDES;
/**
 * Picks made in this process before the stored map was read. The read merges
 * them over what it finds, so an early pick never drops another channel's.
 */
let pendingPicks: Record<string, ChatDensity | null> = {};
/** Whether the stored map was read; until then a write would overwrite it. */
let channelsHydrated = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Reads the stored choice once; a choice made before the read lands wins. */
export function hydrateChatDensity(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(CHAT_DENSITY_STORAGE_KEY)
      .then((raw) => {
        if (chosen) return;
        const stored = parseChatDensity(raw);
        if (stored !== density) {
          density = stored;
          notify();
        }
      })
      .catch(() => {
        /* Cozy, the default, stands. */
      });
    const channels = AsyncStorage.getItem(CHAT_CHANNEL_DENSITY_STORAGE_KEY)
      .then((raw) => {
        let merged = parseChannelDensityMap(raw);
        for (const [channelId, pick] of Object.entries(pendingPicks)) {
          merged = withChannelDensity(merged, channelId, pick);
        }
        const hadPicks = Object.keys(pendingPicks).length > 0;
        pendingPicks = {};
        channelsHydrated = true;
        overrides = merged;
        notify();
        if (hadPicks) persistOverrides();
      })
      .catch(() => {
        // Unreadable: picks hold for this process but are never written,
        // since a write would replace a map we couldn't see.
      });
    hydration = Promise.all([hydration, channels]).then(() => undefined);
  }
  return hydration;
}

void hydrateChatDensity();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void hydrateChatDensity();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ChatDensity {
  return density;
}

function getOverrides(): ChannelDensityMap {
  return overrides;
}

/**
 * The member's default density on this phone, or, given a channel, what that
 * channel draws: the formal display if the channel is set to Always formal
 * (#3787), else its override if the member set one, else the default.
 */
export function useChatDensity(channelId?: string | null): ChatDensity {
  const fallback = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const map = useSyncExternalStore(subscribe, getOverrides, getOverrides);
  const locked = useSyncExternalStore(
    subscribeLockedChannels,
    getLockedChannels,
    getLockedChannels,
  );
  return resolveChannelDensity(
    fallback,
    map,
    channelId,
    channelId ? locked.has(channelId) : false,
  );
}

/**
 * Whether the channel is set to Always formal (#3787), from the channel list
 * the screens copy into `@repo/chat-core/density` (`syncLockedChannels`).
 */
export function useChannelDisplayLocked(
  channelId: string | null | undefined,
): boolean {
  const locked = useSyncExternalStore(
    subscribeLockedChannels,
    getLockedChannels,
    getLockedChannels,
  );
  return channelId ? locked.has(channelId) : false;
}

/** The channel's own override on this phone, or `null` when it follows the default. */
export function useChannelDensityOverride(
  channelId: string | null | undefined,
): ChatDensity | null {
  const map = useSyncExternalStore(subscribe, getOverrides, getOverrides);
  return (channelId ? map[channelId] : undefined) ?? null;
}

/** Pins a channel to a density on this phone, or back to the default with `null`. */
export function setChannelDensity(
  channelId: string,
  next: ChatDensity | null,
): void {
  overrides = withChannelDensity(overrides, channelId, next);
  notify();
  if (channelsHydrated) {
    persistOverrides();
  } else {
    pendingPicks[channelId] = next;
    void hydrateChatDensity();
  }
}

function persistOverrides(): void {
  AsyncStorage.setItem(
    CHAT_CHANNEL_DENSITY_STORAGE_KEY,
    JSON.stringify(overrides),
  ).catch(() => {
    /* Best-effort, as the default is. */
  });
}

export function setChatDensity(next: ChatDensity): void {
  chosen = true;
  density = next;
  notify();
  AsyncStorage.setItem(CHAT_DENSITY_STORAGE_KEY, next).catch(() => {
    /* Best-effort: the choice holds until the app restarts. */
  });
}

/** Test seam: back to a fresh process. */
export function resetChatDensityForTests(): void {
  density = DEFAULT_CHAT_DENSITY;
  hydration = null;
  chosen = false;
  overrides = NO_OVERRIDES;
  pendingPicks = {};
  channelsHydrated = false;
  listeners.clear();
}
