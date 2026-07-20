import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationRoot = path.join(repositoryRoot, ".netlify-dist");
const publicationManifest = JSON.parse(await readFile(path.join(repositoryRoot, "publication-manifest.json"), "utf8"));
const capability = publicationManifest.bridge.aiAccess;
const failures = [];
const authorityNotice = "This is a deterministic, derived, read-only representation. The unchanged compiler runtime remains authoritative.";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sourceFilename(sourceId) {
  return `${sourceId.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "")}.md`;
}

function fail(message) {
  failures.push(message);
}

async function filesBelow(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const member = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(root, ...member.split("/"));
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) fail(`Rejected symlink: ${absolute}`);
    else if (info.isDirectory()) files.push(...await filesBelow(root, member));
    else if (info.isFile()) files.push(member);
    else fail(`Rejected non-file member: ${absolute}`);
  }
  return files;
}

function parseJson(buffer, label) {
  try { return JSON.parse(buffer.toString("utf8")); } catch (error) { fail(`${label}: invalid JSON (${error.message})`); return {}; }
}

function parseJsonl(buffer, label) {
  return buffer.toString("utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { fail(`${label}:${index + 1}: invalid JSON (${error.message})`); return {}; }
  });
}

function requireText(text, pattern, label) {
  if (!pattern.test(text)) fail(label);
}

function requireFile(fileSet, relativePath, label) {
  if (!fileSet.has(relativePath)) fail(label ?? `Missing ${relativePath}`);
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

async function snapshotDerived() {
  const snapshot = new Map();
  for (const publication of publicationManifest.publications) {
    const root = path.join(destinationRoot, publication.path, "_bridge");
    for (const relativePath of await filesBelow(root)) {
      const buffer = await readFile(path.join(root, ...relativePath.split("/")));
      snapshot.set(`${publication.path}/_bridge/${relativePath}`, sha256(buffer));
    }
  }
  for (const relativePath of ["index.html", "publications.json", ".ai-discovery.json", "ai-discovery.json", "llms.txt", "robots.txt", "sitemap.xml"]) {
    const buffer = await readFile(path.join(destinationRoot, relativePath));
    snapshot.set(relativePath, sha256(buffer));
  }
  return snapshot;
}

let runtimeFiles = 0;
let runtimeBytes = 0;
let htmlDerivedFiles = 0;
let aiDerivedFiles = 0;
let sourcesRepresented = 0;
let chunksRepresented = 0;

const rootDiscovery = parseJson(await readFile(path.join(destinationRoot, ".ai-discovery.json")), ".ai-discovery.json");
const rootDiscoveryAlias = await readFile(path.join(destinationRoot, "ai-discovery.json"));
if (sha256(await readFile(path.join(destinationRoot, ".ai-discovery.json"))) !== sha256(rootDiscoveryAlias)) fail("Root discovery alias differs from .ai-discovery.json");
const llms = await readFile(path.join(destinationRoot, "llms.txt"), "utf8");
if (rootDiscovery.schema !== "matrix.publication-bridge.root-discovery/v1") fail("Root discovery schema is incorrect");
if (rootDiscovery.publications?.length !== publicationManifest.publications.length) fail("Root discovery publication count is incomplete");
for (const publication of publicationManifest.publications) {
  requireText(llms, new RegExp(publication.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `llms.txt omits ${publication.id}`);
  requireText(llms, new RegExp(`${publication.path}/_bridge/ai/v1/context\\.md`, "u"), `llms.txt omits preferred context for ${publication.id}`);
}

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
    if (!destination) fail(`${publication.id}: missing runtime artifact ${relativePath}`);
    else if (source.length !== destination.length || sha256(source) !== sha256(destination)) fail(`${publication.id}: runtime byte-fidelity failure ${relativePath}`);
  }

  const manifest = parseJson(await readFile(path.join(sourceRoot, "manifest.json")), `${publication.id}/manifest.json`);
  const catalog = parseJson(await readFile(path.join(sourceRoot, "catalog.json")), `${publication.id}/catalog.json`);
  const graph = parseJson(await readFile(path.join(sourceRoot, "graph.json")), `${publication.id}/graph.json`);
  const lexical = parseJson(await readFile(path.join(sourceRoot, "lexical-index.json")), `${publication.id}/lexical-index.json`);
  const chunks = parseJsonl(await readFile(path.join(sourceRoot, "chunks.jsonl")), `${publication.id}/chunks.jsonl`);
  const corpus = parseJsonl(await readFile(path.join(sourceRoot, "corpus.jsonl")), `${publication.id}/corpus.jsonl`);
  const validation = parseJson(await readFile(path.join(sourceRoot, "validation.json")), `${publication.id}/validation.json`);
  const certificationExists = await lstat(path.join(sourceRoot, "merged-document-certification.json")).then((info) => info.isFile(), () => false);
  const certification = certificationExists ? parseJson(await readFile(path.join(sourceRoot, "merged-document-certification.json")), `${publication.id}/certification`) : null;

  const htmlRoot = path.join(destinationPublication, "_bridge", "html");
  const htmlFiles = new Set(await filesBelow(htmlRoot));
  htmlDerivedFiles += htmlFiles.size;
  for (const expected of ["index.html", "explorer.css", "explorer.js"]) requireFile(htmlFiles, expected, `${publication.id}: missing HTML adapter product ${expected}`);

  const aiRoot = path.join(destinationPublication, "_bridge", "ai", "v1");
  const aiFiles = new Set(await filesBelow(aiRoot));
  aiDerivedFiles += aiFiles.size;
  const required = ["index.md", "index.html", "discovery.json", "context.md", "manifest.md", "catalog.md", "graph.md", "lexical-index.md", "chunks/index.md", "corpus/index.md", "validation.md", "certification.md", "blobs.md", "merged-documents.md"];
  for (const expected of required) requireFile(aiFiles, expected, `${publication.id}: missing AI Level 1 product ${expected}`);

  const landing = await readFile(path.join(destinationPublication, "index.html"), "utf8");
  for (const [pattern, label] of [[/_bridge\/html\//u, "Runtime Explorer"], [/_bridge\/ai\/v1\/index\.md/u, "AI-readable publication"], [new RegExp(publication.entryArtifact.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), "primary artifact"], [/href="manifest\.json"/u, "raw manifest"]]) requireText(landing, pattern, `${publication.id}: landing page omits ${label}`);

  const index = await readFile(path.join(aiRoot, "index.md"), "utf8");
  const context = await readFile(path.join(aiRoot, "context.md"), "utf8");
  const manifestPage = await readFile(path.join(aiRoot, "manifest.md"), "utf8");
  const catalogPage = await readFile(path.join(aiRoot, "catalog.md"), "utf8");
  const validationPage = await readFile(path.join(aiRoot, "validation.md"), "utf8");
  const certificationPage = await readFile(path.join(aiRoot, "certification.md"), "utf8");
  for (const [name, text] of [["index.md", index], ["context.md", context], ["manifest.md", manifestPage], ["catalog.md", catalogPage], ["validation.md", validationPage], ["certification.md", certificationPage]]) {
    requireText(text, new RegExp(authorityNotice.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `${publication.id}/${name}: authority notice missing`);
    if (/Loading(?: certified runtime)?…?/iu.test(text) || /<script\b/iu.test(text)) fail(`${publication.id}/${name}: static access depends on SPA content`);
    if (Buffer.byteLength(text) < 150) fail(`${publication.id}/${name}: principal content is not substantive`);
  }
  for (const heading of ["Publication Identity", "Authority and Provenance", "Runtime Status", "Publication Summary", "Knowledge Domains", "Source Directory", "Retrieval Routes", "Validation and Certification", "Citation and Traceability Rules", "Raw Authoritative Artifacts"]) requireText(context, new RegExp(`^# ${heading}$`, "mu"), `${publication.id}/context.md: missing fixed heading ${heading}`);
  requireText(index, new RegExp(manifest.build_id, "u"), `${publication.id}/index.md: build ID inaccurate`);
  requireText(index, new RegExp(`Source count: ${manifest.documents.length}`, "u"), `${publication.id}/index.md: source count inaccurate`);
  requireText(index, new RegExp(`Chunk count: ${chunks.length}`, "u"), `${publication.id}/index.md: chunk count inaccurate`);
  requireText(index, new RegExp(`Graph nodes: ${graph.nodes.length}`, "u"), `${publication.id}/index.md: graph node count inaccurate`);
  requireText(index, new RegExp(`Graph edges: ${graph.edges.length}`, "u"), `${publication.id}/index.md: graph edge count inaccurate`);
  requireText(index, new RegExp(`Lexical terms: ${Object.keys(lexical.terms ?? {}).length}`, "u"), `${publication.id}/index.md: lexical count inaccurate`);
  requireText(validationPage, new RegExp(`Valid: \\*\\*${validation.valid}\\*\\*`, "u"), `${publication.id}/validation.md: validation status inaccurate`);
  requireText(certificationPage, certification?.valid ? /Valid: \*\*true\*\*/u : /does not publish a separate/u, `${publication.id}/certification.md: certification status inaccurate`);

  const sourcePages = [...aiFiles].filter((name) => /^corpus\/[^/]+\.md$/u.test(name) && name !== "corpus/index.md");
  sourcesRepresented += sourcePages.length;
  if (sourcePages.length !== manifest.documents.length) fail(`${publication.id}: expected ${manifest.documents.length} source pages, found ${sourcePages.length}`);
  const expectedSourcePages = new Set(manifest.documents.map((source) => `corpus/${sourceFilename(source.source_id)}`));
  if (expectedSourcePages.size !== manifest.documents.length) fail(`${publication.id}: deterministic source filenames collide`);
  for (const expected of expectedSourcePages) requireFile(aiFiles, expected, `${publication.id}: missing source page ${expected}`);
  for (const [order, source] of manifest.documents.entries()) {
    const relativePath = `corpus/${sourceFilename(source.source_id)}`;
    const sourcePage = await readFile(path.join(aiRoot, ...relativePath.split("/")), "utf8");
    requireText(sourcePage, new RegExp(source.source_id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"), `${publication.id}/${relativePath}: source ID missing`);
    requireText(sourcePage, new RegExp(`Source order: ${order + 1} of ${manifest.documents.length}`, "u"), `${publication.id}/${relativePath}: source order inaccurate`);
    requireText(sourcePage, new RegExp(source.sha256, "u"), `${publication.id}/${relativePath}: blob hash missing`);
    const marker = new RegExp(`<!-- MKC-BLOB-TEXT-BEGIN sha256=${source.sha256} -->\\n([\\s\\S]*?)<!-- MKC-BLOB-TEXT-END -->`, "u");
    const match = sourcePage.match(marker);
    if (!match) fail(`${publication.id}/${relativePath}: certified source text boundary missing`);
    else {
      const blob = await readFile(path.join(sourceRoot, "blobs", "sha256", source.sha256.slice(0, 2), source.sha256));
      const expectedText = `${blob.toString("utf8")}${blob.toString("utf8").endsWith("\n") ? "" : "\n"}`;
      if (match[1] !== expectedText) fail(`${publication.id}/${relativePath}: certified source text differs from blob`);
    }
  }

  const chunkPageNames = [...aiFiles].filter((name) => /^chunks\/page-\d{4}\.md$/u.test(name)).sort();
  const expectedChunkPages = Math.max(1, Math.ceil(chunks.length / capability.pageSize));
  if (chunkPageNames.length !== expectedChunkPages) fail(`${publication.id}: chunk pagination expected ${expectedChunkPages}, found ${chunkPageNames.length}`);
  const exposedChunkIds = [];
  for (const name of chunkPageNames) {
    const text = await readFile(path.join(aiRoot, ...name.split("/")), "utf8");
    exposedChunkIds.push(...[...text.matchAll(/^## (chk:[^\r\n]+)$/gmu)].map((match) => match[1]));
  }
  chunksRepresented += exposedChunkIds.length;
  if (exposedChunkIds.length !== chunks.length || new Set(exposedChunkIds).size !== chunks.length || chunks.some((chunk, index) => exposedChunkIds[index] !== chunk.chunk_id)) fail(`${publication.id}: chunk pagination is incomplete, duplicated, or unstable`);

  const graphPages = [...aiFiles].filter((name) => /^graph-pages\/page-\d{4}\.md$/u.test(name));
  const lexicalPages = [...aiFiles].filter((name) => /^lexical-pages\/page-\d{4}\.md$/u.test(name));
  if (graphPages.length !== Math.max(1, Math.ceil(graph.edges.length / capability.pageSize))) fail(`${publication.id}: graph pagination incomplete`);
  if (lexicalPages.length !== Math.max(1, Math.ceil(Object.keys(lexical.terms ?? {}).length / capability.pageSize))) fail(`${publication.id}: lexical pagination incomplete`);
  const graphEdgeMentions = (await Promise.all(graphPages.map((name) => readFile(path.join(aiRoot, ...name.split("/")), "utf8")))).reduce((total, text) => total + countMatches(text, /^\| `edge:[^`]+` \|/gmu), 0);
  if (graphEdgeMentions !== graph.edges.length) fail(`${publication.id}: graph relationship representation incomplete`);

  for (const relativePath of aiFiles) {
    const buffer = await readFile(path.join(aiRoot, ...relativePath.split("/")));
    if (relativePath.endsWith(".md") && buffer.length > capability.maxPageBytes) fail(`${publication.id}/${relativePath}: exceeds configured page bound`);
  }

  const discovery = parseJson(await readFile(path.join(aiRoot, "discovery.json")), `${publication.id}/discovery.json`);
  if (discovery.publication?.build_id !== manifest.build_id || discovery.counts?.sources !== manifest.documents.length || discovery.counts?.chunks !== chunks.length) fail(`${publication.id}: discovery facts are inaccurate`);
  if (discovery.preferred_entry !== `${publicationManifest.site.baseUrl}${publication.path}/_bridge/ai/v1/context.md`) fail(`${publication.id}: preferred discovery entry is not canonical`);
  if (corpus.length !== manifest.documents.length || catalog.entries.length !== manifest.documents.length) fail(`${publication.id}: authoritative source inventories disagree`);
}

const firstSnapshot = await snapshotDerived();
execFileSync(process.execPath, [path.join(repositoryRoot, "scripts", "assemble-publications.mjs")], { cwd: repositoryRoot, stdio: "pipe" });
const secondSnapshot = await snapshotDerived();
if (firstSnapshot.size !== secondSnapshot.size) fail("Repeated assembly changed derived product inventory");
for (const [relativePath, digest] of firstSnapshot) if (secondSnapshot.get(relativePath) !== digest) fail(`Repeated assembly changed derived product bytes: ${relativePath}`);

if (failures.length) {
  console.error(`Publication Bridge verification failed (${failures.length} problem${failures.length === 1 ? "" : "s"}):`);
  for (const problem of failures) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`Runtime byte fidelity: PASS (${runtimeFiles} files, ${runtimeBytes} bytes)`);
  console.log(`HTML adapter isolation: PASS (${htmlDerivedFiles} files under _bridge/html)`);
  console.log(`AI Level 1 static contract: PASS (${aiDerivedFiles} files under _bridge/ai/v1)`);
  console.log(`Source representation: PASS (${sourcesRepresented} sources exactly once)`);
  console.log(`Bounded chunk access: PASS (${chunksRepresented} chunks in stable pages)`);
  console.log(`Root discovery and landing links: PASS (${publicationManifest.publications.length} publications)`);
  console.log(`Repeated assembly determinism: PASS (${firstSnapshot.size} derived destination products)`);
}
