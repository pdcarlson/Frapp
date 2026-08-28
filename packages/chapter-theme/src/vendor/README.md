# Vendored third-party source

## `generate-radix-colors.ts`

| | |
| --- | --- |
| Upstream | [`radix-ui/website`](https://github.com/radix-ui/website) → `components/generate-radix-colors.tsx` |
| Commit | `88a9f14dbe36e7285d32df01e139b0ab2e1de574` (2026-06-15) |
| Vendored | 2026-08-14 |
| License | MIT, © 2024 WorkOS — full text in the file header |
| Size | 581 lines upstream (620 here, with the header) |

### Why it is vendored rather than installed

The generator is not published to npm. It lives in Radix's website repo, where it
powers the custom-palette tool at <https://www.radix-ui.com/colors/custom>.
`@radix-ui/colors` — which *is* a dependency of this package — ships only the
static, pre-built scales; it does not export this function.

Reimplementing it was the alternative and was rejected: it is ~580 lines of
oklch math with hand-tuned bezier curves, and
[`spec/ui/design-system/accent-engine.md`](../../../../spec/ui/design-system/accent-engine.md)
§8 guarantees accent contrast *by construction*. That guarantee is only worth
anything if the construction is the one the guarantee was written against.

### Modifications

One: renamed `.tsx` → `.ts`. The file contains no JSX (the `<...>` occurrences
are generic type parameters). Contents are otherwise byte-for-byte upstream, so
`git diff` against a fresh download is a clean provenance check.

### Runtime dependencies

Pinned to match upstream's own `package.json` exactly, because the generator is
written and tested against these versions and the color math is the point:

- `@radix-ui/colors@3.0.0` — reference scales. No `exports` map, resolves via `main`, so CommonJS-safe.
- `colorjs.io@0.5.2` — exact pin, as upstream. Later majors move to ESM-first.
- `bezier-easing@^2.1.0` — as upstream. `3.x` is ESM-only.

All three are MIT and dependency-free. They are `dependencies`, not
`devDependencies`, because `apps/api/Dockerfile` runs `npm ci --omit=dev` and the
API calls into this package at runtime.

### Resyncing

```bash
curl -sSL -o /tmp/gen.tsx \
  https://raw.githubusercontent.com/radix-ui/website/main/components/generate-radix-colors.tsx
```

Diff it against everything below this file's header block. If it has changed,
re-vendor, update the commit SHA and date above, and re-run the palette tests —
[`../signet.spec.ts`](../signet.spec.ts) asserts contrast holds by construction,
which is exactly what a generator change could break.

### Lint and type rules

ESLint skips this directory: it is upstream code held under
`--max-warnings 0`, and reformatting it would destroy the provenance diff. It is
still typechecked and still built, so a genuine incompatibility surfaces.
