#!/usr/bin/env node

// Builds supabase/seed/chapter_directory.csv from Wikipedia's "List of …
// chapters" articles, and records exactly which revision of each article every
// row came from in supabase/seed/chapter_directory.sources.json (#232).
//
// Why Wikipedia: it is the one public source that lists chapters for every
// national organization in one shape, with the institution linked to its own
// article (so "Rensselaer Polytechnic Institute" arrives as the school's full
// name, not "RPI"). The national organizations' own chapter locators are each
// a different website, several behind JavaScript.
//
// What it does:
//   1. Reads the member tables of the three umbrella councils (NIC, NPC, NPHC)
//      for organization names, Greek letters and archetype, and adds the
//      organizations of other archetypes listed in EXTRA_ORGS.
//   2. Finds each organization's chapter-list article, following redirects.
//   3. Keeps the chapters each list marks active (a Status column saying
//      "Active", or, where a list has no Status column, a chapter name in bold,
//      the convention those lists use), at a named institution.
//   4. Writes one CSV row per chapter, with the school's short name and the
//      names people search for it by (school-names.mjs).
//
// Usage (needs en.wikipedia.org reachable):
//   node scripts/chapter-directory/build-from-wikipedia.mjs [--cache DIR] [--offline]
//
// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node 24+, or
// 22 with the experimental agent); a sandbox behind the agent proxy needs it.
// --offline rebuilds from the pages the last online run saved in the cache.
//
// Then regenerate the load SQL into a NEW migration:
//   node scripts/load-chapter-directory.mjs > supabase/migrations/<ts>_chapter_directory_<what>.sql
//
// Requests are spaced a second apart and identify the project in the
// User-Agent, as Wikimedia's API etiquette asks.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { firstLink, isBold, plainText, readChapterTemplates, readTables } from "./wikitext.mjs";
import { schoolNames } from "./school-names.mjs";
import { EXPECTED_HEADER, SEED_RELATIVE_PATH } from "../lib/chapter-directory-seed.mjs";

const INDEX = "https://en.wikipedia.org/w/index.php";
const USER_AGENT =
  "FrappDirectoryBuilder/1.0 (https://github.com/pdcarlson/Frapp; chapter directory seed)";
const SOURCES_RELATIVE_PATH = join("supabase", "seed", "chapter_directory.sources.json");

/** The placeholder accent every directory row has carried; the wizards prefer the org's own colors. */
const DEFAULT_COLORS = { accent: "#C9A56F" };

const COUNCILS = [
  { page: "North American Interfraternity Conference", archetype: "ifc" },
  { page: "National Panhellenic Conference", archetype: "npc" },
  { page: "National Pan-Hellenic Council", archetype: "nphc" },
];

/**
 * Organizations outside the three councils that the directory carried before
 * this script existed (the multicultural, professional and honor rows), so a
 * chapter of one of them can still be found. Letters and archetype are the
 * ones the previous seed held.
 */
const EXTRA_ORGS = [
  { name: "Lambda Theta Alpha", letters: "ΛΘΑ", archetype: "mgc" },
  { name: "Lambda Upsilon Lambda", letters: "ΛΥΛ", archetype: "mgc" },
  { name: "Alpha Kappa Delta Phi", letters: "αΚΔΦ", archetype: "mgc" },
  { name: "Tau Beta Pi", letters: "ΤΒΠ", archetype: "honor" },
  { name: "Phi Beta Kappa", letters: "ΦΒΚ", archetype: "honor" },
  { name: "Pi Tau Sigma", letters: "ΠΤΣ", archetype: "honor" },
  { name: "Theta Tau", letters: "ΘΤ", archetype: "professional" },
  { name: "Delta Sigma Pi", letters: "ΔΣΠ", archetype: "professional" },
  { name: "Alpha Chi Sigma", letters: "ΑΧΣ", archetype: "professional" },
  { name: "Alpha Kappa Psi", letters: "ΑΚΨ", archetype: "professional" },
];

/**
 * Names members type for an organization besides its full name. Searched,
 * never shown. Only the widely used ones; a chapter that goes by something
 * else still finds itself by the full name.
 */
const ORG_ALIASES = {
  "Phi Gamma Delta": ["FIJI", "Phi Gam"],
  "Sigma Phi Epsilon": ["SigEp", "Sig Ep"],
  "Pi Kappa Alpha": ["Pike", "PIKE"],
  "Sigma Alpha Epsilon": ["SAE"],
  "Phi Delta Theta": ["Phi Delt"],
  "Kappa Alpha Order": ["KA"],
  "Alpha Tau Omega": ["ATO"],
  "Phi Kappa Psi": ["Phi Psi"],
  "Beta Theta Pi": ["Beta"],
  "Delta Tau Delta": ["Delts"],
  "Lambda Chi Alpha": ["Lambda Chi"],
  "Alpha Epsilon Pi": ["AEPi"],
  "Theta Chi": ["TX"],
  "Sigma Chi": ["Sig Chi"],
  "Kappa Sigma": ["Kappa Sig"],
  "Delta Kappa Epsilon": ["DKE", "Deke"],
  "Delta Upsilon": ["DU"],
  "Zeta Beta Tau": ["ZBT"],
  "Tau Kappa Epsilon": ["TKE", "Teke"],
  "Pi Kappa Phi": ["Pi Kapp"],
  "Phi Kappa Tau": ["Phi Tau"],
  "Alpha Sigma Phi": ["Alpha Sig"],
  "Sigma Phi Delta": ["Sigma Phi Delt"],
  "Delta Chi": ["D Chi"],
  "Alpha Phi Alpha": ["Alphas"],
  "Omega Psi Phi": ["Ques"],
  "Kappa Alpha Psi": ["Nupes"],
  "Phi Beta Sigma": ["Sigmas"],
  "Delta Delta Delta": ["Tri Delta", "Tri-Delt"],
  "Kappa Kappa Gamma": ["Kappa", "KKG"],
  "Kappa Alpha Theta": ["Theta"],
  "Pi Beta Phi": ["Pi Phi"],
  "Alpha Delta Pi": ["ADPi"],
  "Alpha Omicron Pi": ["AOPi"],
  "Alpha Chi Omega": ["AXO", "A Chi O"],
  "Zeta Tau Alpha": ["ZTA"],
  "Delta Gamma": ["DG"],
  "Alpha Xi Delta": ["Alpha Xi"],
  "Sigma Delta Tau": ["SDT"],
  "Alpha Epsilon Phi": ["AEPhi"],
};

/** Greek letter names to letters, for organizations named by their letters. */
const GREEK = {
  alpha: "Α", beta: "Β", gamma: "Γ", delta: "Δ", epsilon: "Ε", zeta: "Ζ",
  eta: "Η", theta: "Θ", iota: "Ι", kappa: "Κ", lambda: "Λ", mu: "Μ", nu: "Ν",
  xi: "Ξ", omicron: "Ο", pi: "Π", rho: "Ρ", sigma: "Σ", tau: "Τ",
  upsilon: "Υ", phi: "Φ", chi: "Χ", psi: "Ψ", omega: "Ω",
};

const GREEK_RE = /[Ͱ-Ͽ]/;

function parseArgs(argv) {
  const args = { cache: join(process.cwd(), ".cache", "chapter-directory"), offline: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--cache") args.cache = argv[++i];
    else if (argv[i] === "--offline") args.offline = true;
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

/**
 * GET a Wikipedia URL, a second apart, backing off on 429/5xx. Returns
 * `null` on 404.
 *
 * It reads `index.php` (`action=raw` for wikitext, `action=info` for the
 * revision id) rather than `api.php`: from a shared sandbox egress address the
 * API answered 429 for minutes at a time on 2026-11-06 while `index.php`
 * served every request.
 */
async function get(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastRequest + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      await sleep(5000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return res.text();
  }
  throw new Error(`gave up after retries: ${url}`);
}

const pageUrl = (title, action) =>
  `${INDEX}?${new URLSearchParams({ title: title.replace(/ /g, "_"), action })}`;

/** `{ title, revid, text }` for a page, following up to two redirects; null when missing. */
async function fetchPage(asked) {
  let title = asked;
  for (let hop = 0; hop < 3; hop++) {
    const text = await get(pageUrl(title, "raw"));
    if (text === null) return null;
    const redirect = /^#REDIRECT\s*\[\[([^\]|#]+)/i.exec(text.trimStart());
    if (redirect) {
      title = redirect[1].trim().replace(/_/g, " ");
      continue;
    }
    const info = await get(pageUrl(title, "info"));
    const revid = Number(/"wgCurRevisionId":(\d+)/.exec(info ?? "")?.[1]) || null;
    return { title, revid, text };
  }
  return null;
}

/**
 * The current wikitext and revision id of each title, keyed by the title as
 * asked, following redirects. Missing pages are absent from the result. Every
 * page lands in `cacheDir` with an `index.json`, which `--offline` rebuilds
 * from without asking Wikipedia again.
 */
async function fetchPages(titles, cacheDir, offline) {
  const indexPath = join(cacheDir, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
  const out = new Map();
  for (const asked of titles) {
    if (offline) {
      const hit = index[asked];
      if (hit) out.set(asked, { ...hit, text: readFileSync(join(cacheDir, hit.file), "utf8") });
      continue;
    }
    const page = await fetchPage(asked);
    if (!page) continue;
    const file = `${page.title.replace(/[^\w.-]+/g, "_")}.wiki`;
    writeFileSync(join(cacheDir, file), page.text);
    index[asked] = { title: page.title, revid: page.revid, file };
    writeFileSync(indexPath, JSON.stringify(index, null, 2));
    out.set(asked, page);
  }
  return out;
}

function lettersFromName(name) {
  const words = name.split(/\s+/);
  if (!words.every((w) => GREEK[w.toLowerCase()])) return null;
  return words.map((w) => GREEK[w.toLowerCase()]).join("");
}

/** Members of a council, from the first table whose header names Greek letters or symbols. */
function councilMembers(wikitext, archetype) {
  // "Active former members" are organizations that left the council but still
  // have chapters (Sigma Phi Epsilon, Kappa Sigma, Phi Delta Theta).
  const tables = readTables(wikitext).filter((t) =>
    /current member|active former member|affiliate/i.test(t.section),
  );
  const orgs = [];
  for (const t of tables) {
    const nameCol = t.header.findIndex((h) => /fraternity|sorority|name|organization/i.test(h));
    const lettersCol = t.header.findIndex((h) => /letters|symbols/i.test(h));
    if (nameCol === -1) continue;
    for (const row of t.rows) {
      const link = firstLink(row[nameCol] ?? "");
      if (!link) continue;
      const name = plainText(link.text);
      const fromTable = lettersCol === -1 ? "" : plainText(row[lettersCol] ?? "").replace(/\s|and.*$/g, "");
      const letters = GREEK_RE.test(fromTable) ? fromTable : lettersFromName(name);
      orgs.push({ name, article: link.target, letters, archetype });
    }
  }
  return orgs;
}

const SKIP_SECTION_RE = /\b(graduate|alumni|alumnae|former|defunct|honorary|see also|notes|references)\b/i;

/** Column indexes of a chapter table, or null when it isn't one. */
function chapterColumns(header, rows) {
  const find = (re) => header.findIndex((h) => re.test(h));
  let institution = find(/institution|college|university|school|campus|founding location/i);
  if (institution === -1) {
    // Some lists call the school column "Location" and put the city beside it.
    const loc = find(/location/i);
    const schoolish = (c) => /universit|college|institut|school|academy/i.test(plainText(c ?? ""));
    if (loc !== -1 && rows.filter((r) => schoolish(r[loc])).length > rows.length / 2) institution = loc;
  }
  // Zeta Tau Alpha calls its chapters "links".
  let chapter = find(/^(chapter|chapter name|name|link)$/i);
  if (chapter === -1) chapter = find(/^chapter(?! number| no)|chapter name/i);
  if (institution === -1 || chapter === -1 || chapter === institution) return null;
  return {
    chapter,
    institution,
    status: find(/status|active/i),
    charter: find(/charter|install|founded|date|established/i),
  };
}

const ACTIVE_RE = /\bactive\b|\bcolony\b|\bprovisional\b|\bassociate chapter\b|\bre-?(chartered|established|colonized)\b/i;
const INACTIVE_RE = /\binactive\b|\bdormant\b|\bclosed\b|\bsuspended\b|\bwithdrawn\b|\bmerged\b|\bdefunct\b|\brevoked\b|\bexpelled\b/i;

/** The institution's canonical name: its article title, unless the link points elsewhere. */
/** One spelling for a campus suffix: "Texas A&M University - Kingsville" and "…University-Kingsville" are "…University–Kingsville". */
function normalizeSchool(name) {
  return name.replace(/\s+[-–]\s+/g, "–").replace(/(University|College)-(?=[A-Z])/g, "$1–").trim();
}

function institutionName(cell) {
  const link = firstLink(cell);
  const text = plainText(cell).replace(/\s*\(.*?\)\s*/g, " ").replace(/[;,]\s*$/, "").trim();
  if (!link) return { name: normalizeSchool(text), shown: text };
  const target = link.target.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // A link whose target shares no word with the cell is a city or a former
  // name's redirect gone stale; keep what the list shows.
  const share = target.split(/\s+/).some((w) => w.length > 3 && text.includes(w));
  return { name: normalizeSchool(share || text === "" ? target : text), shown: plainText(link.text) };
}

/** "Delta Psi; See also Rho" -> "Delta Psi"; "(Colony)" and stray punctuation go. */
function cleanDesignation(text) {
  const t = text
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/[;,]?\s*see also\b.*$/i, "")
    .replace(/^[\s|;,)]+|[\s|;,)(]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

function chapterRows(org, page) {
  const rows = [];
  const unread = [];
  for (const table of [...readTables(page.text), ...readChapterTemplates(page.text)]) {
    if (SKIP_SECTION_RE.test(table.section)) continue;
    const cols = chapterColumns(table.header, table.rows);
    if (!cols) {
      if (table.rows.length > 5) unread.push(`${table.section || "(lead)"}: ${table.header.join(" / ")}`);
      continue;
    }
    for (const row of table.rows) {
      const chapterCell = row[cols.chapter] ?? "";
      const status = cols.status === -1 ? "" : plainText(row[cols.status] ?? "");
      const active = cols.status === -1
        ? isBold(chapterCell)
        : ACTIVE_RE.test(status) && !INACTIVE_RE.test(status.replace(/re-?activated/i, ""));
      if (!active) continue;
      const { name: university, shown } = institutionName(row[cols.institution] ?? "");
      if (!university || /^(n\/a|none|unknown|—|-)$/i.test(university)) continue;
      const designation = cleanDesignation(plainText(chapterCell));
      const charter = cols.charter === -1 ? "" : plainText(row[cols.charter] ?? "");
      const year = /\b(1[7-9]\d\d|20[0-2]\d)\b/.exec(charter)?.[1];
      rows.push({ university, shown, designation, founded_year: year ? Number(year) : null });
    }
  }
  return { rows, unread };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const args = parseArgs(process.argv);
  mkdirSync(args.cache, { recursive: true });
  const previous = readPreviousSeed();

  // 1. Organizations.
  const councilPages = await fetchPages(COUNCILS.map((c) => c.page), args.cache, args.offline);
  const orgs = new Map();
  for (const council of COUNCILS) {
    const page = councilPages.get(council.page);
    if (!page) throw new Error(`could not read ${council.page}`);
    for (const org of councilMembers(page.text, council.archetype)) {
      if (!orgs.has(org.name)) orgs.set(org.name, org);
    }
  }
  for (const extra of EXTRA_ORGS) {
    if (!orgs.has(extra.name)) orgs.set(extra.name, { ...extra, article: extra.name });
  }
  const skippedOrgs = [];
  for (const [name, org] of orgs) {
    if (!org.letters) {
      skippedOrgs.push({ org: name, reason: "no Greek letters" });
      orgs.delete(name);
    }
  }

  // 2. Each organization's chapter list.
  const candidates = new Map();
  for (const org of orgs.values()) {
    const titles = [...new Set([
      `List of ${org.article} chapters`,
      `List of ${org.name} chapters`,
      `List of ${org.article.replace(/\s*\(.*\)$/, "")} chapters`,
    ])];
    candidates.set(org.name, titles);
  }
  const lists = await fetchPages([...new Set([...candidates.values()].flat())], args.cache, args.offline);

  // 3 + 4. Rows.
  const out = [];
  const sources = [];
  for (const org of orgs.values()) {
    const title = candidates.get(org.name).find((t) => lists.has(t));
    if (!title) {
      skippedOrgs.push({ org: org.name, reason: "no chapter-list article" });
      continue;
    }
    const page = lists.get(title);
    const { rows, unread } = chapterRows(org, page);
    const seen = new Set();
    let kept = 0;
    for (const r of rows) {
      const key = `${r.university}|${r.designation ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const school = schoolNames(r.university, r.shown);
      out.push({
        org_letters: org.letters,
        org_name: org.name,
        archetype: org.archetype,
        chapter_designation: r.designation,
        university: r.university,
        university_short: school.short,
        founded_year: r.founded_year,
        default_colors: DEFAULT_COLORS,
        website: previous.get(org.name)?.website ?? null,
        source: "wikipedia",
        aliases: [...new Set([...(ORG_ALIASES[org.name] ?? []), ...school.aliases])],
      });
      kept++;
    }
    sources.push({
      org: org.name,
      article: page.title,
      revision: page.revid,
      url: `https://en.wikipedia.org/w/index.php?oldid=${page.revid}`,
      active_chapters: kept,
      ...(unread.length ? { tables_not_read: unread } : {}),
    });
    if (kept === 0) skippedOrgs.push({ org: org.name, reason: `no active chapters read from ${page.title}` });
  }

  out.sort((a, b) =>
    a.org_name.localeCompare(b.org_name) ||
    a.university.localeCompare(b.university) ||
    (a.chapter_designation ?? "").localeCompare(b.chapter_designation ?? ""),
  );

  const lines = [EXPECTED_HEADER.join(",")];
  for (const r of out) {
    lines.push(EXPECTED_HEADER.map((h) => {
      if (h === "default_colors") return csvCell(JSON.stringify(r.default_colors));
      if (h === "aliases") return csvCell(r.aliases.join("|"));
      return csvCell(r[h]);
    }).join(","));
  }
  writeFileSync(join(process.cwd(), SEED_RELATIVE_PATH), lines.join("\n") + "\n");
  writeFileSync(
    join(process.cwd(), SOURCES_RELATIVE_PATH),
    JSON.stringify({
      built: new Date().toISOString().slice(0, 10),
      builder: "scripts/chapter-directory/build-from-wikipedia.mjs",
      rows: out.length,
      organizations: sources.sort((a, b) => a.org.localeCompare(b.org)),
      skipped: skippedOrgs.sort((a, b) => a.org.localeCompare(b.org)),
    }, null, 2) + "\n",
  );
  console.error(`${out.length} chapters from ${sources.length} organizations; ${skippedOrgs.length} organizations skipped.`);
}

/** Websites the previous seed held, by organization name. */
function readPreviousSeed() {
  const path = join(process.cwd(), SEED_RELATIVE_PATH);
  const map = new Map();
  if (!existsSync(path)) return map;
  const [header, ...rows] = readFileSync(path, "utf8").trim().split("\n");
  const cols = header.split(",");
  const nameIdx = cols.indexOf("org_name");
  const siteIdx = cols.indexOf("website");
  for (const line of rows) {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "")) ?? [];
    const site = cells[siteIdx];
    if (cells[nameIdx] && site && site.startsWith("http")) map.set(cells[nameIdx], { website: site });
  }
  return map;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
