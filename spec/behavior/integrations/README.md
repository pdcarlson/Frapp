# Ops Integrations

The "modules-as-integrations" pattern (slash command + rich message renderer + system channel + optional dashboard surface) is delivered via Chunk 10. Each ops module gets its own sub-chunk (10a–10h) and integrates with chat as the primary surface.

## Chunks (co-located briefs)

- [`chunks/10-ops-integrations.md`](chunks/10-ops-integrations.md) — the full Chunk 10 brief covering all eight sub-chunks (10a Events, 10b Tasks, 10c Points, 10d Dues, 10e Rush, 10f Backwork, 10g Reports, 10h Onboarding pathway).

## Related per-module behavior

Each integration has stable rules already specced in the matching behavior topic:

- 10a Events → [`../events.md`](../events.md)
- 10b Tasks → [`../tasks.md`](../tasks.md)
- 10c Points → [`../points.md`](../points.md)
- 10d Dues → [`../billing.md`](../billing.md)
- 10f Backwork → [`../backwork.md`](../backwork.md)
- 10g Reports → [`../reports.md`](../reports.md)
- 10h Onboarding pathway → [`../onboarding/README.md`](../onboarding/README.md)

10e Rush has no stable behavior spec yet (chunk 10e will introduce it).
