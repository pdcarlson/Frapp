# `@repo/eslint-config`

Shared ESLint flat configs used across the monorepo.

## Exports

- `@repo/eslint-config/base` — baseline TypeScript + Turbo rules.
- `@repo/eslint-config/isomorphic` — `base` plus a ban on DOM globals, for packages that must
  never touch one because the NestJS API or React Native loads them. A package that
  feature-detects the browser on purpose (`@repo/chat-core`) stays on `base`. Why: the comment
  in [`isomorphic.js`](./isomorphic.js).
- `@repo/eslint-config/next-js` — Next.js + React + hooks config.
- `@repo/eslint-config/react-internal` — React library config for shared packages.

React workspaces share [`react-hooks.js`](./react-hooks.js): `eslint-plugin-react-hooks` v7
`recommended` also turns on React Compiler rules. The shared config **allowlists** every
rule in that preset at upstream severity. A later plugin bump that adds a new
`recommended` rule stays `"off"` until a dedicated cleanup. Why:
[`docs/ci-cd/agent-infra.md`](../../docs/ci-cd/agent-infra.md).

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
export { config as default } from "@repo/eslint-config/base";
```

### Package that must never touch a DOM global

```js
export { isomorphicConfig as default } from "@repo/eslint-config/isomorphic";
```
