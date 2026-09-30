// Preloaded with `node --import` in storage-backup.test.mjs's end-to-end
// tests: replaces fetch with the Supabase Storage REST calls the backup
// makes, served from FAKE_STORAGE, a JSON file of { bucket: { path: content } }.
// A string is the object's bytes. Other contents are listed, then:
//   null  -- deleted as its download arrives: an object deleted between the
//            listing and the download, gone from any later listing;
//   false -- the download answers 500: a failed read of an object that exists;
//   true  -- the download answers "not found" but the object stays listed: a
//            row whose bytes are missing;
//   { bytes, download } -- listed as `bytes` (so its etag is unchanged), and
//            its download behaves as `download`: "vanish" (null above), 500
//            (false above) or "missing" (true above).
// "Not found" is HTTP 400 with "404" only in the body, as storage-api answers
// it. Uploads (POST) and deletes (DELETE), which the rehearsal and restore make,
// are written back to FAKE_STORAGE so a test can see what the run left.
import fs from "node:fs";

const file = process.env.FAKE_STORAGE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const etag = (content) => `"${Buffer.from(content).toString("hex").slice(0, 16)}"`;
const notFound = () => ({
  ok: false,
  status: 400,
  json: async () => ({ statusCode: "404", error: "not_found", message: "Object not found" }),
  arrayBuffer: async () => Buffer.from(""),
});

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
      const bytes = typeof content === "string" ? content : (content?.bytes ?? "");
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
      if (typeof state[bucket]?.[objectPath] !== "string") return notFound();
      delete state[bucket][objectPath];
      save();
      return { ok: true, status: 200 };
    }
    const stored = state[bucket]?.[objectPath];
    const content =
      stored?.download === "vanish" ? null : stored?.download === 500 ? false : stored?.download === "missing" ? true : stored;
    if (content === null) {
      delete state[bucket][objectPath];
      save();
      return notFound();
    }
    if (content === false) return { ok: false, status: 500, arrayBuffer: async () => Buffer.from("") };
    if (typeof content !== "string") return notFound();
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(content) };
  }
  throw new Error(`fake storage: unmocked ${url}`);
};
