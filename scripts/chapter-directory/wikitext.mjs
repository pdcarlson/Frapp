// Just enough of a MediaWiki wikitext reader to turn Wikipedia's chapter-list
// tables into rows: strip markup from a cell, keep a link's target, and walk a
// `{| … |}` table into cells with `rowspan` carried down.
//
// Plain dependency-free ESM, like the rest of scripts/lib, so it runs from a
// bare `node` before anything is installed. It is not a general wikitext
// parser and does not try to be one: it reads the table shapes the "List of …
// chapters" articles use, and `build-from-wikipedia.mjs` reports every table it
// could not read rather than guessing.

/** Remove `<ref>…</ref>`, `<ref …/>` and HTML comments. */
export function stripRefsAndComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref\b[^>/]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
}

/**
 * Remove `{{…}}` templates, nested ones included, keeping what a reader would
 * see for the few that carry the text itself: `{{lang|grc|ΦΓΔ}}` and
 * `{{DTS|…}}` / `{{dts|…}}` (a date) keep their last positional argument or
 * the date parts. Everything else (`{{Efn|…}}`, `{{Refh}}`, `{{sticky-header}}`)
 * goes.
 */
export function stripTemplates(text) {
  let out = text;
  // Innermost first, until no template is left.
  for (let guard = 0; guard < 20 && out.includes("{{"); guard++) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_, body) => keptTemplateText(body));
    if (next === out) break;
    out = next;
  }
  return out;
}

function keptTemplateText(body) {
  const parts = body.split("|").map((p) => p.trim());
  const name = parts[0].toLowerCase();
  const positional = parts.slice(1).filter((p) => !/^[a-z_-]+\s*=/i.test(p));
  if (name === "lang" || name === "script") return positional.at(-1) ?? "";
  if (name === "dts" || name === "date table sorting" || name === "start date") {
    return positional.join(" ");
  }
  if (name === "nowrap" || name === "nobr" || name === "sort") {
    return positional.at(-1) ?? "";
  }
  return "";
}

/**
 * The first wikilink in a cell, as `{ target, text }`: `[[A|B]]` gives target
 * "A", text "B"; `[[A]]` gives both "A". `null` when the cell has no link.
 */
export function firstLink(cell) {
  const m = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(cell);
  if (!m) return null;
  const target = decodeEntities(m[1].trim().replace(/_/g, " "));
  const text = (m[2] ?? m[1]).trim();
  return { target, text };
}

/** A cell's visible text: links become their label, markup and refs go. */
export function plainText(cell) {
  let t = stripTemplates(stripRefsAndComments(cell));
  // Hidden sort keys: `<span style="display:none">0307</span>Eta Gamma`.
  t = t.replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "");
  // A row line written `||Tau Chi` leaves a stray bar on its first cell.
  t = t.replace(/^\s*\|+/, "");
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
  t = t.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1");
  t = t.replace(/\[https?:\/\/[^\]]*\]/g, "");
  t = t.replace(/<br\s*\/?>/gi, "; ");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/'''''|'''|''/g, "");
  return decodeEntities(t).replace(/\s+/g, " ").trim();
}

/** The handful of HTML entities these lists use. */
export function decodeEntities(t) {
  return t
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'");
}

/** Bold (`'''…'''`) marks an active chapter in most of these lists. */
export function isBold(cell) {
  return /'''[^']/.test(stripRefsAndComments(cell));
}

/** Split `attrs | content` (a cell with attributes) into its two halves. */
function splitAttributes(raw) {
  // An attribute block has `=` before the first single `|` and no link or
  // template open before it, e.g. ` rowspan="2" | [[Foo]]`.
  const idx = findSingleBar(raw);
  if (idx === -1) return { attrs: "", content: raw };
  const head = raw.slice(0, idx);
  if (!/=/.test(head) || /\[\[|\{\{/.test(head)) return { attrs: "", content: raw };
  return { attrs: head, content: raw.slice(idx + 1) };
}

/** Index of the first `|` that is not part of `||`, a link or a template. */
function findSingleBar(s) {
  let depthLink = 0;
  let depthTpl = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "[[") { depthLink++; i++; continue; }
    if (two === "]]") { depthLink = Math.max(0, depthLink - 1); i++; continue; }
    if (two === "{{") { depthTpl++; i++; continue; }
    if (two === "}}") { depthTpl = Math.max(0, depthTpl - 1); i++; continue; }
    if (depthLink || depthTpl) continue;
    if (two === "||") return -1;
    if (s[i] === "|") return i;
  }
  return -1;
}

/** Split an inline `a || b || c` row line on `||` outside links and templates. */
function splitInline(s, sep) {
  const out = [];
  let depthLink = 0;
  let depthTpl = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === "[[") { depthLink++; i++; continue; }
    if (two === "]]") { depthLink = Math.max(0, depthLink - 1); i++; continue; }
    if (two === "{{") { depthTpl++; i++; continue; }
    if (two === "}}") { depthTpl = Math.max(0, depthTpl - 1); i++; continue; }
    if (!depthLink && !depthTpl && two === sep) {
      out.push(s.slice(start, i));
      start = i + 2;
      i++;
    }
  }
  out.push(s.slice(start));
  return out;
}

/**
 * Every top-level `{| … |}` table in the text, as `{ header: string[],
 * rows: string[][], section: string }`. Header cells are plain text; row
 * cells are raw wikitext (so callers can still read links and bold), with
 * `rowspan` values copied down into the rows they span. `section` is the
 * nearest `== heading ==` above the table.
 */
export function readTables(wikitext) {
  const text = stripRefsAndComments(wikitext);
  const lines = text.split("\n");
  const tables = [];
  let section = "";
  let current = null;
  let depth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^(={2,})\s*(.*?)\s*\1$/.exec(line);
    if (heading && depth === 0) {
      section = plainText(heading[2]);
      continue;
    }
    if (line.startsWith("{|")) {
      depth++;
      if (depth === 1) current = { section, headerRaw: [], headerDone: false, rowsRaw: [], row: null };
      continue;
    }
    if (line.startsWith("|}")) {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && current) {
        if (current.row) current.rowsRaw.push(current.row);
        tables.push(finishTable(current));
        current = null;
      }
      continue;
    }
    if (!current || depth !== 1) continue;

    if (line.startsWith("|-")) {
      if (current.row) current.rowsRaw.push(current.row);
      if (current.headerRaw.length > 0) current.headerDone = true;
      current.row = [];
      continue;
    }
    if (line.startsWith("|+")) continue; // caption
    if (line.startsWith("!")) {
      const cells = splitInline(line.slice(1), "!!").flatMap((c) => splitInline(c, "||"));
      // Header cells until the first row break after them; after that a `!`
      // cell is a row header (`! scope="row" | Alpha`), which is data.
      const into = current.headerDone ? (current.row ??= []) : current.headerRaw;
      for (const c of cells) into.push(splitAttributes(c));
      continue;
    }
    if (line.startsWith("|")) {
      if (!current.row) current.row = [];
      for (const c of splitInline(line.slice(1), "||")) {
        current.row.push(splitAttributes(c));
      }
      continue;
    }
    // A continuation line belongs to the last cell.
    if (current.row && current.row.length > 0) {
      const last = current.row[current.row.length - 1];
      last.content += "\n" + rawLine;
    }
  }
  return tables;
}

function finishTable(t) {
  const header = t.headerRaw.map((c) => plainText(c.content));
  const rows = [];
  // pending[col] = { content, left } for rowspans still covering later rows.
  const pending = [];
  for (const rawRow of t.rowsRaw) {
    if (rawRow.length === 0) continue;
    const row = [];
    let src = 0;
    let col = 0;
    while (src < rawRow.length || pending.some((p, i) => p && p.left > 0 && i >= col)) {
      if (pending[col] && pending[col].left > 0) {
        row.push(pending[col].content);
        pending[col].left--;
        col++;
        continue;
      }
      if (src >= rawRow.length) break;
      const cell = rawRow[src++];
      const span = /rowspan\s*=\s*"?(\d+)"?/i.exec(cell.attrs);
      if (span && Number(span[1]) > 1) {
        pending[col] = { content: cell.content, left: Number(span[1]) - 1 };
      }
      row.push(cell.content);
      col++;
    }
    rows.push(row);
  }
  return { section: t.section, header, rows };
}

/** Split a template body on its top-level `|`, outside links and nested templates. */
function splitTemplateArgs(body) {
  const out = [];
  let depthLink = 0;
  let depthTpl = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "[[") { depthLink++; i++; continue; }
    if (two === "]]") { depthLink = Math.max(0, depthLink - 1); i++; continue; }
    if (two === "{{") { depthTpl++; i++; continue; }
    if (two === "}}") { depthTpl = Math.max(0, depthTpl - 1); i++; continue; }
    if (!depthLink && !depthTpl && body[i] === "|") {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/**
 * Chapters written as `{{FratChapter|Chapter Name=…|School=…|Status=…}}`
 * templates instead of a table (Phi Beta Sigma's list), returned in the same
 * `{ section, header, rows }` shape as `readTables`, one table per section.
 */
export function readChapterTemplates(wikitext) {
  const text = stripRefsAndComments(wikitext);
  const tables = [];
  const header = ["Chapter", "Charter date", "Institution", "Status"];
  const keys = [
    ["chapter name", "chapter"],
    ["founded", "charter date", "chartered", "date"],
    ["school", "institution", "college", "university"],
    ["status"],
  ];
  const re = /\{\{\s*FratChapter\s*\|/gi;
  let section = "";
  let current = null;
  let cursor = 0;
  let m;
  while ((m = re.exec(text))) {
    // Track the nearest heading above this template.
    const between = text.slice(cursor, m.index);
    for (const h of between.matchAll(/^(={2,})\s*(.*?)\s*\1\s*$/gm)) section = plainText(h[2]);
    // Balanced end of this template.
    let depth = 0;
    let end = m.index;
    for (let i = m.index; i < text.length; i++) {
      const two = text.slice(i, i + 2);
      if (two === "{{") { depth++; i++; continue; }
      if (two === "}}") { depth--; i++; if (depth === 0) { end = i + 1; break; } }
    }
    cursor = end;
    const body = text.slice(m.index + 2, end - 2);
    const args = new Map();
    for (const part of splitTemplateArgs(body).slice(1)) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      args.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
    }
    if (!current || current.section !== section) {
      current = { section, header, rows: [] };
      tables.push(current);
    }
    current.rows.push(keys.map((alts) => alts.map((k) => args.get(k)).find((v) => v !== undefined) ?? ""));
  }
  return tables;
}
