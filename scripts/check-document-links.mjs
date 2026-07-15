import { access, readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const documents = [new URL("README.md", root)];
const docsDirectory = new URL("docs/", root);

for (const entry of await readdir(docsDirectory, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".md")) {
    documents.push(new URL(entry.name, docsDirectory));
  }
}

const missing = [];
for (const document of documents) {
  const source = await readFile(document, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1];
    if (
      rawTarget === undefined ||
      rawTarget.startsWith("http://") ||
      rawTarget.startsWith("https://") ||
      rawTarget.startsWith("#")
    ) {
      continue;
    }
    const fileTarget = rawTarget.split("#", 1)[0];
    if (fileTarget === undefined || fileTarget.length === 0) {
      continue;
    }
    const target = new URL(fileTarget, document);
    try {
      await access(target);
    } catch {
      missing.push(`${document.pathname}: missing local link '${rawTarget}'`);
    }
  }
}

if (missing.length > 0) {
  console.error(missing.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked local links in ${documents.length} Markdown document(s).`);
}
