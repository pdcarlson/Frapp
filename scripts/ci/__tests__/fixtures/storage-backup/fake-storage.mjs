// Preloaded with `node --import` in storage-backup.test.mjs's end-to-end
// tests: replaces fetch with the Supabase Storage REST calls the backup
// makes, served from FAKE_STORAGE, a JSON file of { bucket: { path: content } }.
// A content of `null` is listed but 404s on download: an object deleted
// between the listing and the download. A content of `false` is listed but
// answers 500: a download that fails for any other reason. Uploads (POST) and
// deletes (DELETE), which the rehearsal and restore make, are written back to
// FAKE_STORAGE so a test can see what the run left in Storage.
import fs from "node:fs";

const file = process.env.FAKE_STORAGE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const etag = (content) => `"${Buffer.from(content).toString("hex").slice(0, 16)}"`;

globalThis.fetch = async (url, init = {}) => {
  const { pathname } = new URL(url);
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  if (pathname === "/storage/v1/bucket") return json(Object.keys(state).map((name) => ({ name })));

  let match = pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
  if (match) {
    const { prefix, offset } = JSON.parse(init.body);
    if (offset > 0) return json([]);
    const level = prefix ? `${prefix}/` : "";
    const rows = new Map();
    for (const [objectPath, content] of Object.entries(state[match[1]] ?? {})) {
      if (!objectPath.startsWith(level)) continue;
      const [head, ...rest] = objectPath.slice(level.length).split("/");
      const bytes = typeof content === "string" ? content : "";
      rows.set(head, rest.length
        ? { name: head, id: null }
        : { name: head, id: "id", updated_at: "2026-09-01T00:00:00Z", metadata: { size: Buffer.byteLength(bytes), eTag: etag(bytes), mimetype: "text/plain" } });
    }
    return json([...rows.values()]);
  }

  match = pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (match) {
    const [bucket, objectPath] = [match[1], decodeURIComponent(match[2])];
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "POST") {
      state[bucket] ??= {};
      state[bucket][objectPath] = Buffer.from(init.body).toString("utf8");
      save();
      return { ok: true, status: 200 };
    }
    if (method === "DELETE") {
      const found = typeof state[bucket]?.[objectPath] === "string";
      if (found) delete state[bucket][objectPath];
      save();
      return { ok: found, status: found ? 200 : 404 };
    }
    const content = state[bucket]?.[objectPath];
    if (content === false) return { ok: false, status: 500, arrayBuffer: async () => Buffer.from("") };
    const found = typeof content === "string";
    return { ok: found, status: found ? 200 : 404, arrayBuffer: async () => Buffer.from(content ?? "") };
  }
  throw new Error(`fake storage: unmocked ${url}`);
};
