#!/usr/bin/env node

import { execSync } from "node:child_process";

const GENERATED_ARTIFACTS = [
  "apps/api/openapi.json",
  "packages/api-sdk/src/types.ts",
];

function run(command) {
  execSync(command, { stdio: "inherit" });
}

function getStdout(command) {
  return execSync(command, { encoding: "utf8" }).trim();
}

function main() {
  run("npm run openapi:export -w apps/api");
  run("npm run generate -w packages/api-sdk");

  const changed = getStdout(
    `git diff --name-only -- ${GENERATED_ARTIFACTS.join(" ")}`,
  )
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  if (changed.length > 0) {
    console.error("API contract drift check failed.");
    console.error("");
    console.error(
      "The generated OpenAPI/SDK artifacts are out of date. Run the following and commit results:",
    );
    console.error("  npm run openapi:export -w apps/api");
    console.error("  npm run generate -w packages/api-sdk");
    console.error("");
    console.error("Changed files:");
    for (const file of changed) {
      console.error(`- ${file}`);
    }
    process.exit(1);
  }

  console.log("API contract drift check passed.");
}

main();
