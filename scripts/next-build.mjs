#!/usr/bin/env node
/**
 * Runs `next build` with NODE_ENV pinned to "production".
 *
 * Why this wrapper exists (FRA-305): `next build` does NOT force a production NODE_ENV.
 * `next/dist/bin/next` only warns and then does
 *   process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv
 * so an ambient `NODE_ENV=development` (the cloud sandbox exports one) survives into the
 * build. Next then selects its server runtime purely off that value in
 * `next/dist/server/route-modules/app-page/module.compiled.js`, loading the React *dev*
 * runtime to prerender chunks Turbopack compiled against the React *prod* runtime. Two
 * React copies means the prod copy's dispatcher is null, so the first hook in Next's own
 * OuterLayoutRouter — `useContext(LayoutRouterContext)` — throws
 *   TypeError: Cannot read properties of null (reading 'useContext')
 * and every prerendered route dies. Which route is named in the error is just whichever
 * worker got there first, which is why it looked like a `/_global-error` bug.
 *
 * Pinning it here keeps `npm run build` deterministic no matter what the shell exports.
 * `next build --debug-prerender` still works: Next sets NODE_ENV=development itself in
 * its own action handler, which runs after this env is handed to the child.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { join } from "node:path";

const cwd = process.cwd();

// Resolve `next` from the workspace that invoked us rather than from this script's own
// location, so a workspace pinning its own Next version still builds with that version.
const requireFromWorkspace = createRequire(join(cwd, "package.json"));

let nextBin;
try {
  nextBin = requireFromWorkspace.resolve("next/dist/bin/next");
} catch {
  console.error(
    `next-build: could not resolve "next" from ${cwd}. Run it from a Next.js workspace, e.g. \`npm run build -w web\`.`,
  );
  process.exit(1);
}

const inherited = process.env.NODE_ENV;
if (inherited && inherited !== "production") {
  console.log(
    `next-build: forcing NODE_ENV=production for this build (inherited "${inherited}").`,
  );
}

const child = spawn(
  process.execPath,
  [nextBin, "build", ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: "production" } },
);

child.on("error", (err) => {
  console.error(`next-build: failed to start \`next build\`: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  // Mirror the shell convention (128 + signal number) so a killed build is not
  // mistaken for a clean exit by turbo or CI.
  process.exit(signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 1));
});
