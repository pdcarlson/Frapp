# `@repo/eslint-config`

Shared ESLint flat configs used across the monorepo.

## Exports

- `@repo/eslint-config/base` — baseline TypeScript + Turbo rules.
- `@repo/eslint-config/next-js` — Next.js + React + hooks config.
- `@repo/eslint-config/react-internal` — React library config for shared packages.

React workspaces share [`react-hooks.js`](./react-hooks.js): `eslint-plugin-react-hooks` v7
`recommended` also turns on React Compiler rules. The shared config **allowlists** every
rule in that preset at upstream severity. A later plugin bump that adds a new
`recommended` rule stays `"off"` until a dedicated cleanup. Why:
[`docs/internal/ci-cd/AGENT_INFRA.md`](../../docs/internal/ci-cd/AGENT_INFRA.md).

## Usage examples

### Next.js app

```js
import { nextJsConfig } from "@repo/eslint-config/next-js";

export default [...nextJsConfig];
```

### React package

```js
import { config } from "@repo/eslint-config/react-internal";

export default config;
```

### TypeScript package

```js
import { config as baseConfig } from "@repo/eslint-config/base";

export default baseConfig;
```
