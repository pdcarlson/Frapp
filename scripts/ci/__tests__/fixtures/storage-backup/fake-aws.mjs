// A stand-in for the `aws` CLI in storage-backup.test.mjs's end-to-end tests:
// the three commands scripts/storage-backup-run.mjs issues, against a local
// directory (FAKE_S3/<bucket>/<key>) instead of R2. A missing key fails the way
// the real CLI does, so the 404-vs-failed-read split is exercised too.
import fs from "node:fs";
import path from "node:path";

const root = process.env.FAKE_S3;
const argv = process.argv.slice(2);
const args = argv.filter((a, i) => a !== "--only-show-errors" && a !== "--endpoint-url" && argv[i - 1] !== "--endpoint-url");
const local = (uri) => path.join(root, uri.replace(/^s3:\/\//, ""));
const flag = (name) => args[args.indexOf(name) + 1];

if (args[0] === "s3" && args[1] === "cp") {
  const [src, dst] = [args[2], args[3]];
  if (src.startsWith("s3://")) {
    if (!fs.existsSync(local(src))) {
      process.stderr.write("fatal error: An error occurred (404) when calling the HeadObject operation: Not Found\n");
      process.exit(1);
    }
    fs.copyFileSync(local(src), dst);
  } else {
    fs.mkdirSync(path.dirname(local(dst)), { recursive: true });
    fs.copyFileSync(src, local(dst));
  }
} else if (args[0] === "s3" && args[1] === "rm") {
  fs.rmSync(local(args[2]), { force: true });
} else if (args[0] === "s3api" && args[1] === "list-objects-v2") {
  const base = path.join(root, flag("--bucket"));
  const prefix = flag("--prefix");
  const pairs = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (path.relative(base, file).startsWith(prefix)) pairs.push([path.relative(base, file), fs.statSync(file).size]);
    }
  };
  walk(base);
  if (flag("--query") !== "Contents[].[Key,Size]") throw new Error(`unexpected --query ${flag("--query")}`);
  process.stdout.write(pairs.length ? JSON.stringify(pairs) : "null\n");
} else {
  process.stderr.write(`fake aws: unsupported ${args.join(" ")}\n`);
  process.exit(2);
}
