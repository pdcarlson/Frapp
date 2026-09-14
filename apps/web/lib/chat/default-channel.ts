/**
 * Which channel a cold load lands on when nothing named one.
 *
 * One definition, two readers, and they must agree or the cache misses on the
 * commonest path there is. `chat-shell.tsx` uses it as the last rung of
 * `activeChannelId` (after `?channel=` and after a still-valid selection);
 * `first-chunk-cache.ts` uses it to decide which tail may never be evicted.
 *
 * Those two were written independently and disagreed. The shell picks a
 * **fixed** default — `#general`, else the first row — while eviction kept the
 * three **most recently written** tails. A member who read `#general` first and
 * then three other channels evicted `#general`, so the next morning's reload,
 * which the shell sends straight to `#general`, found no tail and painted
 * nothing. The cache missed precisely when it was most likely to be wanted.
 *
 * Takes the structural minimum rather than `ChatChannel`, so the cache module
 * can call it without importing the channel rail's types.
 */
export function coldLoadDefaultChannelId(
  channels: readonly { id: string; name: string }[],
): string | null {
  return (
    channels.find((channel) => channel.name === "general")?.id ??
    channels[0]?.id ??
    null
  );
}
