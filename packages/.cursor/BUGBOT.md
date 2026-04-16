## Shared package review focus

- Shared packages affect multiple consumers across API, web, and mobile; flag breaking interface changes early.
- Prefer backward-compatible exports unless all downstream callers are updated in the same change set.
- Call out coupling that would force consumers to know internal implementation details.
