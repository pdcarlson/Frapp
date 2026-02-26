import fs from "fs";
import path from "path";

const specDirectory = path.join(process.cwd(), "../../spec");

export function getDocBySlug(slug: string) {
  const realSlug = slug.replace(/\.md$/, "");
  const fullPath = path.join(specDirectory, `${realSlug}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  const fileContents = fs.readFileSync(fullPath, "utf8");
  const firstLine = fileContents.split("\n").find((l) => l.startsWith("# "));
  const title = firstLine ? firstLine.replace(/^#\s+/, "") : realSlug;

  return { slug: realSlug, title, content: fileContents };
}

export function getAllDocs() {
  if (!fs.existsSync(specDirectory)) return [];

  const files = fs.readdirSync(specDirectory);
  return files
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const fullPath = path.join(specDirectory, file);
      const fileContents = fs.readFileSync(fullPath, "utf8");
      const firstLine = fileContents
        .split("\n")
        .find((l) => l.startsWith("# "));
      const title =
        firstLine?.replace(/^#\s+/, "") ||
        slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
      return { slug, title };
    });
}
