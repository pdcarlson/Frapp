#!/usr/bin/env node
// Publish the migration snapshot: the applied-migration history of every
// deployed Supabase project, read from `main` and handed to pull-request jobs
// as a file (#2518).
//
// ── Why the read moved here ─────────────────────────────────────────────────
// `migration-order`, `migration-replay` and `migration-drift` run on
// `pull_request`. A same-repository PR runs its own branch's workflow
// definitions, so any credential those jobs can read, any branch can read. They
// used to inject Infisical `prod` for one read, and the account-level
// `SUPABASE_ACCESS_TOKEN` that answered it also manages production. This
// script makes that read instead, in `migration-snapshot.yml`, whose job names
// the `automation` environment. That environment is to admit `main` only, set
// by the owner's #2583; until then its secrets are repository-level. The PR
// jobs download what it writes, with `GITHUB_TOKEN` and no secret.
//
// It also replaces `check-migration-order.mjs --probe`. That probe existed to
// prove the CI credential reaches BOTH projects, which a green gate run cannot
// show. Every run of this script is that proof: it fails unless both projects
// answer, and its step summary is the probe's table.
//
// ── Read-only ───────────────────────────────────────────────────────────────
// One GET per project to `GET /v1/projects/{ref}/database/migrations`. No SQL,
// ever. Project refs come from `.github/environments.json`.
//
// Env inputs:
//   SUPABASE_ACCESS_TOKEN  — required, Supabase Management API token
//   GITHUB_SHA, RUN_URL    — optional, recorded as the snapshot's source
//   GITHUB_STEP_SUMMARY    — optional, written when present
//
// Flags:
//   --out <path>           — required, where to write the snapshot JSON
//
// Exit codes:
//   0 — every project was read and the snapshot was written
//   1 — a project could not be read, or answered with an empty history;
//       nothing is written. Consumers keep using the last good snapshot until
//       a deploy outdates it for a pull request's gates (the download
//       action waits, then refuses one read before the latest deploy on
//       main) or it ages out
//   2 — the invocation itself is wrong (no token, no --out, unreadable config)
//
// Unit tests: scripts/ci/__tests__/migration-snapshot.test.mjs.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { fetchAppliedWithRetry } from "./check-migration-drift-gate.mjs";
import { newestVersion, VERSION_PATTERN } from "./check-migration-order.mjs";
import { ENVIRONMENTS, loadEnvironments } from "./lib/environments.mjs";
import { buildSnapshot, SNAPSHOT_ARTIFACT_NAME } from "./lib/migration-snapshot.mjs";

function defaultWriteSummary(text) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `${text}\n`);
  } catch {
    /* a summary that cannot be written must not fail the publish */
  }
}

function defaultWriteFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export async function publishSnapshot({
  accessToken = process.env.SUPABASE_ACCESS_TOKEN,
  outPath,
  environments,
  fetchImpl = fetch,
  nowMs = Date.now(),
  sha = process.env.GITHUB_SHA ?? null,
  runUrl = process.env.RUN_URL ?? null,
  sleepImpl,
  writeFile = defaultWriteFile,
  writeSummary = defaultWriteSummary,
  log = console.log,
  error = console.error,
} = {}) {
  if (!outPath) {
    error("::error::--out <path> is required: where to write the snapshot.");
    return 2;
  }
  if (!accessToken) {
    error(
      "::error::SUPABASE_ACCESS_TOKEN is required. migration-snapshot.yml injects it from " +
        "Infisical `prod`. See docs/internal/environment/SECRETS_MANAGEMENT.md.",
    );
    return 2;
  }

  let resolved;
  try {
    resolved = environments ?? loadEnvironments();
  } catch (thrown) {
    error(`::error::Could not resolve environment identity: ${thrown.message}`);
    return 2;
  }

  const read = [];
  const rows = [];
  let allOk = true;
  for (const name of ENVIRONMENTS) {
    const target = resolved[name];
    if (!target) continue;
    const ref = target.supabaseProjectRef;
    const applied = await fetchAppliedWithRetry({
      accessToken,
      projectRef: ref,
      fetchImpl,
      log,
      ...(sleepImpl ? { sleepImpl } : {}),
    });
    if (!applied.ok) {
      allOk = false;
      rows.push(`| \`${name}\` | \`${ref}\` | — | ❌ ${applied.error} |`);
      error(`::error::${name} (${ref}) could not be read: ${applied.error}`);
      continue;
    }
    // Empty is a wrong ref or a token scoped elsewhere, not a clean database:
    // both projects permanently hold `00000000000000_initial_schema`. Publishing
    // it would hand every consumer "nothing is applied", which reads as clean.
    if (applied.migrations.length === 0 && !target.allowEmptyMigrationHistory) {
      allOk = false;
      rows.push(`| \`${name}\` | \`${ref}\` | 0 | ❌ empty history |`);
      error(
        `::error::${name} (${ref}) returned an EMPTY migration history. Every real project here ` +
          "holds at least `00000000000000_initial_schema`, so this is a wrong project ref, a token " +
          "scoped elsewhere, or a reset project. If the project really is brand new, set " +
          '"allowEmptyMigrationHistory": true for it in .github/environments.json.',
      );
      continue;
    }
    const newest = newestVersion(applied.migrations.filter((m) => VERSION_PATTERN.test(m.version)));
    rows.push(`| \`${name}\` | \`${ref}\` | ${applied.migrations.length} | \`${newest ?? "none"}\` |`);
    log(`  ${name} (${ref}): ${applied.migrations.length} applied, newest ${newest}.`);
    read.push({ name, supabaseProjectRef: ref, migrations: applied.migrations });
  }

  const table = [
    "| Environment | Project ref | Applied | Newest |",
    "| --- | --- | --- | --- |",
    ...rows,
  ];

  if (!allOk) {
    writeSummary(
      [
        "## Migration snapshot: NOT published",
        "",
        ...table,
        "",
        "Nothing was written. PR jobs keep reading the last good snapshot until it passes its age",
        "limit, then every PR that touches a migration fails and names this workflow.",
      ].join("\n"),
    );
    return 1;
  }

  const snapshot = buildSnapshot({
    capturedAt: new Date(nowMs).toISOString(),
    sha,
    runUrl,
    environments: read,
  });
  writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  log(`  Wrote ${outPath}.`);

  writeSummary(
    [
      "## Migration snapshot: published",
      "",
      ...table,
      "",
      `Uploaded as the \`${SNAPSHOT_ARTIFACT_NAME}\` artifact. \`migration-drift-gate.yml\` reads the`,
      "newest one from a successful run on `main`.",
    ].join("\n"),
  );
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function getArg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`Error: ${name} requires a value.`);
    process.exit(2);
  }
  return v;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("publish-migration-snapshot.mjs");
if (isDirectRun) {
  process.exit(await publishSnapshot({ outPath: getArg("--out") }));
}
