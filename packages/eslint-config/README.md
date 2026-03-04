# `@repo/eslint-config`

Shared ESLint flat configs used across the monorepo.

## Exports

- `@repo/eslint-config/base` — baseline TypeScript + Turbo rules.
- `@repo/eslint-config/next-js` — Next.js + React + hooks config.
- `@repo/eslint-config/react-internal` — React library config for shared packages.

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
