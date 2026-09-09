# Performance budgets (web dashboard)

> Part of [Network resilience](README.md).

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial page load (FCP) | < 1.5s | Lighthouse |
| Time to Interactive | < 3.0s | Lighthouse |
| Route transition | < 300ms | Performance observer |
| API response display | < 500ms | From fetch to render |
| Chat message send → display | < 200ms | Optimistic (local) |
| Chat message receive → display | < 500ms | Realtime → render |
| Bundle size (initial JS) | < 200KB gzipped | Webpack analyzer |
| Bundle size (per-route chunk) | < 50KB gzipped | Code splitting |

## Optimization Techniques

- **Code splitting:** Each route is a dynamic import (`next/dynamic` or route-based splitting)
- **Tree shaking:** ShadCN imports are per-component (no barrel exports)
- **Image optimization:** `next/image` for all images, WebP/AVIF
- **Font optimization:** `next/font` for Geist Sans (self-hosted, subset)
- **Prefetching:** `<Link prefetch>` for likely navigation targets (sidebar items)
- **Virtualization:** `@tanstack/react-virtual` for long lists (members, messages, transactions)
