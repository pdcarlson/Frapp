// Production fence for `scripts/db-restore.sh`.
//
// `--force` is the non-local switch: without it, the script refuses anything
// that is not 127.0.0.1 / localhost / host.docker.internal. That is not enough
// once a hosted restore is a real rehearsal (#1861). `--force` is equally true
// of staging and of production, and the difference between those two is one
// mistyped connection string.
//
// Storage restore already refuses production unless
// `STORAGE_BACKUP_ALLOW_PRODUCTION_REHEARSAL=true`. This module is the database
// equivalent: a URL that names the production project in
// `.github/environments.json` is refused unless `DB_RESTORE_ALLOW_PRODUCTION=true`.
// `--force` still required for the hosted hop; this flag is the second hop.
//
// The project ref is not a secret — it is already in the playbook and in
// environments.json. Matching is on host / user (direct `db.<ref>.supabase.co`,
// pooler `postgres.<ref>`, keyword/value `host=` / `user=`), never on the
// password. Resolution goes through `getEnvironment`, not a copy of the ref,
// so a renamed production project updates one file.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getEnvironment } from "./environments.mjs";

/**
 * Strip password material so a staging URL whose password happens to contain
 * the production project ref is not mistaken for a production target.
 *
 * Covers the URI userinfo (`postgres://user:pass@host/db`), query
 * (`?password=…&user=…` — stop at `&`, not at the next non-space), and
 * keyword/value conninfo (`host=… password=…`).
 */
export function redactDbUrl(dbUrl) {
  return String(dbUrl)
    .replace(/^(postgres(?:ql)?:\/\/[^:/?#]+:)([^@]*)@/i, "$1***@")
    .replace(/([?&]password=)[^&]*/gi, "$1***")
    .replace(/(^|\s)(password=)[^\s]*/gi, "$1$2***");
}

function namesRef(value, productionRef) {
  return String(value).toLowerCase().includes(productionRef.toLowerCase());
}

/**
 * True when the connection string names the production project in host or user.
 *
 * Direct hosts (`db.<ref>.supabase.co`), pooler usernames (`postgres.<ref>`),
 * query `user` / `host`, and keyword/value `host=` / `user=` all count.
 * The password does not, by design. Comparison is case-insensitive: DNS and
 * libpq treat the host as case-insensitive, and an uppercased tunnel user
 * would otherwise skip both `--force` (localhost) and this fence.
 */
export function dbUrlNamesProduction(dbUrl, productionRef) {
  if (typeof productionRef !== "string" || productionRef.length === 0) {
    throw new Error("productionRef is required");
  }
  const raw = String(dbUrl);

  if (raw.includes("://")) {
    try {
      const url = new URL(raw);
      const fields = [
        url.hostname,
        url.username,
        url.pathname,
        url.searchParams.get("user"),
        url.searchParams.get("username"),
        url.searchParams.get("host"),
      ];
      return fields.some((value) => value != null && namesRef(value, productionRef));
    } catch {
      // Unparseable URI: fall back to the redacted string rather than allowing.
      return namesRef(redactDbUrl(raw), productionRef);
    }
  }

  for (const part of raw.split(/\s+/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).toLowerCase();
    if (key === "password") continue;
    if (namesRef(part.slice(eq + 1), productionRef)) return true;
  }
  return false;
}

/**
 * Fail closed before `psql` touches the target.
 *
 * @returns {{ productionTarget: boolean, projectRef: string | null }}
 */
export function assertDbRestoreTarget({
  dbUrl,
  allowProduction,
  lookupEnvironment = getEnvironment,
} = {}) {
  if (typeof dbUrl !== "string" || dbUrl.trim() === "") {
    throw new Error(
      "Error: --db-url is required to resolve the production restore fence.",
    );
  }

  const production = lookupEnvironment("production");
  const productionTarget = dbUrlNamesProduction(dbUrl, production.supabaseProjectRef);
  const allow =
    allowProduction ?? process.env.DB_RESTORE_ALLOW_PRODUCTION === "true";

  if (productionTarget && allow !== true) {
    throw new Error(
      `Error: refusing to restore into production (${production.supabaseProjectName}, ` +
        `${production.supabaseProjectRef}) without DB_RESTORE_ALLOW_PRODUCTION=true.\n\n` +
        `--force is not enough: that flag is for any non-local host, including staging. ` +
        `Restoring production replaces the live database. Re-run with ` +
        `DB_RESTORE_ALLOW_PRODUCTION=true once that is the incident you mean.`,
    );
  }

  return {
    productionTarget,
    projectRef: productionTarget ? production.supabaseProjectRef : null,
  };
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return process.argv[1].endsWith("db-restore-target.mjs");
  }
}

if (invokedDirectly()) {
  try {
    assertDbRestoreTarget({ dbUrl: process.env.DB_URL });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
