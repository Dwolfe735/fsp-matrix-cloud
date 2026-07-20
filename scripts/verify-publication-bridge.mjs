import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationRoot = path.join(repositoryRoot, ".netlify-dist");
const publicationManifest = JSON.parse(await readFile(path.join(repositoryRoot, "publication-manifest.json"), "utf8"));
const failures = [];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function filesBelow(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const member = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...member.split("/"));
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) failures.push(`Rejected symlink: ${absolute}`);
    else if (info.isDirectory()) files.push(...await filesBelow(root, member));
    else if (info.isFile()) files.push(member);
    else failures.push(`Rejected non-file member: ${absolute}`);
  }
  return files;
}

function requireText(text, pattern, label) {
  if (!pattern.test(text)) failures.push(label);
}

let runtimeFiles = 0;
let runtimeBytes = 0;
let derivedFiles = 0;
for (const publication of publicationManifest.publications) {
  const sourceRoot = path.join(repositoryRoot, publication.path);
  const destinationPublication = path.join(destinationRoot, publication.path);
  const sourceFiles = await filesBelow(sourceRoot);
  runtimeFiles += sourceFiles.length;
  for (const relativePath of sourceFiles) {
    const [source, destination] = await Promise.all([
      readFile(path.join(sourceRoot, ...relativePath.split("/"))),
      readFile(path.join(destinationPublication, ...relativePath.split("/"))).catch(() => null),
    ]);
    runtimeBytes += source.length;
    if (!destination) failures.push(`${publication.id}: missing runtime artifact ${relativePath}`);
    else if (source.length !== destination.length || sha256(source) !== sha256(destination)) {
      failures.push(`${publication.id}: runtime byte-fidelity failure ${relativePath}`);
    }
  }

  const bridgeRoot = path.join(destinationPublication, "_bridge", "html");
  const bridgeFiles = await filesBelow(bridgeRoot).catch(() => []);
  derivedFiles += bridgeFiles.length;
  for (const expected of ["index.html", "explorer.css", "explorer.js"]) {
    if (!bridgeFiles.includes(expected)) failures.push(`${publication.id}: missing HTML adapter product ${expected}`);
  }
  const landing = await readFile(path.join(destinationPublication, "index.html"), "utf8");
  requireText(landing, /href="_bridge\/html\/"/, `${publication.id}: landing page does not expose Runtime Explorer`);
  const explorer = await readFile(path.join(bridgeRoot, "index.html"), "utf8");
  requireText(explorer, /derived, read-only view/i, `${publication.id}: explorer does not disclose derived status`);
  requireText(explorer, /Authority remains in the unchanged artifacts/i, `${publication.id}: explorer omits authority boundary`);
  const script = await readFile(path.join(bridgeRoot, "explorer.js"), "utf8");
  for (const artifact of ["manifest.json", "catalog.json", "graph.json", "lexical-index.json", "chunks.jsonl", "corpus.jsonl", "validation.json", "merged-document-certification.json", "blobs/sha256/", "primary_outputs"]) {
    if (!script.includes(artifact)) failures.push(`${publication.id}: explorer lacks traceable access for ${artifact}`);
  }
}

const portal = await readFile(path.join(destinationRoot, "index.html"), "utf8");
for (const publication of publicationManifest.publications) {
  requireText(portal, new RegExp(`href="${publication.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\/"`), `Portal omits ${publication.id}`);
}

if (failures.length) {
  console.error(`Publication Bridge verification failed (${failures.length} problem${failures.length === 1 ? "" : "s"}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Runtime byte fidelity: PASS (${runtimeFiles} files, ${runtimeBytes} bytes)`);
  console.log(`HTML adapter isolation: PASS (${derivedFiles} derived files under _bridge/html)`);
  console.log(`Explorer discovery and traceability: PASS (${publicationManifest.publications.length} publications)`);
}

