import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = new URL(process.env.MISSION133_BASE_URL ?? "https://shade-labs.netlify.app/");
if (baseUrl.href !== "https://shade-labs.netlify.app/") throw new Error(`Refusing unapproved production endpoint: ${baseUrl.href}`);
const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "publication-manifest.json"), "utf8"));
const failures = [];

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function git(args) {
  const result = spawnSync("git", ["-c", `safe.directory=${repositoryRoot}`, "-C", repositoryRoot, ...args], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`);
  return result.stdout;
}
function sourceFilename(sourceId) { return `${sourceId.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "")}.md`; }
function pageName(index) { return `page-${String(index + 1).padStart(4, "0")}.md`; }
async function get(relativeOrAbsolute, label) {
  const url = new URL(relativeOrAbsolute, baseUrl);
  if (url.origin !== baseUrl.origin) throw new Error(`${label}: external URL rejected ${url.href}`);
  const response = await fetch(url, { headers: { "user-agent": "MISSION-133-live-verifier/1.0", accept: "*/*" } });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${url.href}`);
  return { url: response.url, buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
}
function parseJson(buffer, label) { try { return JSON.parse(buffer.toString("utf8")); } catch (error) { throw new Error(`${label}: invalid JSON (${error.message})`); } }
function parseJsonl(buffer, label) { return buffer.toString("utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => { try { return JSON.parse(line); } catch (error) { throw new Error(`${label}:${index + 1}: invalid JSON (${error.message})`); } }); }
function htmlLinks(text, url) { return [...text.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)].map((match) => ({ url: new URL(match[1], url).href, label: match[2].replace(/<[^>]+>/gu, "").trim() })); }
function markdownLinks(text, url) { return [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)].map((match) => ({ url: new URL(decodeURI(match[2]), url).href, label: match[1] })); }
function findLink(links, pattern, label) { const found = links.find((item) => pattern.test(item.label)); if (!found) throw new Error(`${label}: missing link ${pattern}`); return found.url; }

// Canonical byte fidelity: compare live bytes directly with Git blob object bytes.
const publicationPaths = manifest.publications.map((publication) => publication.path);
const tree = git(["ls-tree", "-rz", "HEAD", "--", ...publicationPaths]);
const records = tree.toString("utf8").split("\0").filter(Boolean).map((record) => {
  const match = record.match(/^[0-9]+ blob ([0-9a-f]{40})\t([\s\S]+)$/u);
  if (!match) throw new Error(`Unexpected git tree record: ${record}`);
  return { oid: match[1], path: match[2] };
});
const liveRuntime = await Promise.all(records.map(async (record) => ({ record, live: await get(record.path, record.path) })));
let runtimeBytes = 0;
for (const { record, live } of liveRuntime) {
  const canonical = git(["cat-file", "blob", record.oid]);
  runtimeBytes += live.buffer.length;
  if (canonical.length !== live.buffer.length || sha256(canonical) !== sha256(live.buffer)) failures.push(`${record.path}: live bytes differ from canonical Git object ${record.oid}`);
}

// Root static discovery.
const [llmsResponse, rootDiscoveryResponse, portalResponse] = await Promise.all([get("llms.txt", "llms.txt"), get(".ai-discovery.json", "root discovery"), get("", "root")]);
const llms = llmsResponse.buffer.toString("utf8");
const rootDiscovery = parseJson(rootDiscoveryResponse.buffer, ".ai-discovery.json");
if (rootDiscovery.publications?.length !== manifest.publications.length) failures.push("Root discovery publication inventory is incomplete");
for (const publication of manifest.publications) if (!llms.includes(`${publication.path}/_bridge/ai/v1/context.md`)) failures.push(`llms.txt omits ${publication.id}`);

// Decisive no-JavaScript acceptance path, starting from root and following labels.
const portalText = portalResponse.buffer.toString("utf8");
const publicationUrl = findLink(htmlLinks(portalText, portalResponse.url), /BUILD-015|EMMI Operational/u, "root");
const publicationResponse = await get(publicationUrl, "publication landing");
const aiIndexUrl = findLink(htmlLinks(publicationResponse.buffer.toString("utf8"), publicationResponse.url), /AI-readable publication/u, "publication landing");
const aiIndexResponse = await get(aiIndexUrl, "AI index");
const aiIndex = aiIndexResponse.buffer.toString("utf8");
if (/Loading certified runtime/iu.test(aiIndex) || !aiIndex.includes("deterministic, derived, read-only representation")) failures.push("AI index is not substantive static derived content");
const aiLinks = markdownLinks(aiIndex, aiIndexResponse.url);
const contextResponse = await get(findLink(aiLinks, /Preferred AI context/u, "AI index"), "AI context");
const context = contextResponse.buffer.toString("utf8");
for (const heading of ["Publication Identity", "Authority and Provenance", "Runtime Status", "Publication Summary", "Knowledge Domains", "Source Directory", "Retrieval Routes", "Validation and Certification", "Citation and Traceability Rules", "Raw Authoritative Artifacts"]) if (!context.includes(`# ${heading}`)) failures.push(`Context omits ${heading}`);
const sourceDirectoryResponse = await get(findLink(aiLinks, /Source directory/u, "AI index"), "source directory");
const sourceUrl = findLink(markdownLinks(sourceDirectoryResponse.buffer.toString("utf8"), sourceDirectoryResponse.url), /EMMI|BUILD-015|MISSION/u, "source directory");
const sourceResponse = await get(sourceUrl, "source page");
const sourceText = sourceResponse.buffer.toString("utf8");
const sourceLinks = markdownLinks(sourceText, sourceResponse.url);
const chunkResponse = await get(findLink(sourceLinks, /^chk:/u, "source page"), "chunk page");
if (!/^## chk:/mu.test(chunkResponse.buffer.toString("utf8"))) failures.push("Discovered chunk page lacks chunk identity");
await get(findLink(sourceLinks, /Unchanged authoritative blob/u, "source page"), "unchanged blob");
for (const label of ["Validation", "Certification", "Raw manifest", "Raw catalog"]) await get(findLink(aiLinks, new RegExp(`^${label}$`, "u"), "AI index"), label);

// Complete live Level 1 derivation reconciliation for every publication.
let aiFilesVerified = 0;
let sourcesVerified = 0;
let chunksVerified = 0;
for (const publication of manifest.publications) {
  const prefix = `${publication.path}/`;
  const [runtimeManifestResponse, catalogResponse, graphResponse, lexicalResponse, chunksResponse, corpusResponse, validationResponse, discoveryResponse] = await Promise.all([
    get(`${prefix}manifest.json`, `${publication.id} manifest`), get(`${prefix}catalog.json`, `${publication.id} catalog`),
    get(`${prefix}graph.json`, `${publication.id} graph`), get(`${prefix}lexical-index.json`, `${publication.id} lexical index`),
    get(`${prefix}chunks.jsonl`, `${publication.id} chunks`), get(`${prefix}corpus.jsonl`, `${publication.id} corpus`),
    get(`${prefix}validation.json`, `${publication.id} validation`), get(`${prefix}_bridge/ai/v1/discovery.json`, `${publication.id} AI discovery`),
  ]);
  const runtimeManifest = parseJson(runtimeManifestResponse.buffer, `${publication.id}/manifest.json`);
  const catalog = parseJson(catalogResponse.buffer, `${publication.id}/catalog.json`);
  const graph = parseJson(graphResponse.buffer, `${publication.id}/graph.json`);
  const lexical = parseJson(lexicalResponse.buffer, `${publication.id}/lexical-index.json`);
  const chunks = parseJsonl(chunksResponse.buffer, `${publication.id}/chunks.jsonl`);
  const corpus = parseJsonl(corpusResponse.buffer, `${publication.id}/corpus.jsonl`);
  const validation = parseJson(validationResponse.buffer, `${publication.id}/validation.json`);
  const discovery = parseJson(discoveryResponse.buffer, `${publication.id}/discovery.json`);
  if (!validation.valid || discovery.publication?.build_id !== runtimeManifest.build_id) failures.push(`${publication.id}: runtime status or discovery build identity is inaccurate`);
  if (discovery.counts?.sources !== runtimeManifest.documents.length || discovery.counts?.chunks !== chunks.length || discovery.counts?.graph_nodes !== graph.nodes.length || discovery.counts?.graph_edges !== graph.edges.length || discovery.counts?.lexical_terms !== Object.keys(lexical.terms ?? {}).length) failures.push(`${publication.id}: live discovery counts are inaccurate`);
  if (catalog.entries.length !== runtimeManifest.documents.length || corpus.length !== runtimeManifest.documents.length) failures.push(`${publication.id}: source inventories disagree`);

  const sourcePageResponses = await Promise.all(runtimeManifest.documents.map((source) => get(`${prefix}_bridge/ai/v1/corpus/${sourceFilename(source.source_id)}`, `${publication.id} source ${source.source_id}`)));
  sourcesVerified += sourcePageResponses.length;
  for (const [index, source] of runtimeManifest.documents.entries()) {
    const page = sourcePageResponses[index].buffer.toString("utf8");
    const marker = page.match(new RegExp(`<!-- MKC-BLOB-TEXT-BEGIN sha256=${source.sha256} -->\\n([\\s\\S]*?)<!-- MKC-BLOB-TEXT-END -->`, "u"));
    const blob = await get(`${prefix}blobs/sha256/${source.sha256.slice(0, 2)}/${source.sha256}`, `${publication.id} blob ${source.sha256}`);
    const expectedText = `${blob.buffer.toString("utf8")}${blob.buffer.toString("utf8").endsWith("\n") ? "" : "\n"}`;
    if (!marker || marker[1] !== expectedText || sha256(blob.buffer) !== source.sha256 || blob.buffer.length !== source.size) failures.push(`${publication.id}: source page or blob fidelity failure ${source.source_id}`);
  }

  const chunkPageCount = Math.max(1, Math.ceil(chunks.length / manifest.bridge.aiAccess.pageSize));
  const chunkPages = await Promise.all(Array.from({ length: chunkPageCount }, (_, index) => get(`${prefix}_bridge/ai/v1/chunks/${pageName(index)}`, `${publication.id} chunk page ${index + 1}`)));
  aiFilesVerified += sourcePageResponses.length + chunkPages.length;
  const exposedChunkIds = chunkPages.flatMap((response) => [...response.buffer.toString("utf8").matchAll(/^## (chk:[^\r\n]+)$/gmu)].map((match) => match[1]));
  chunksVerified += exposedChunkIds.length;
  if (exposedChunkIds.length !== chunks.length || chunks.some((chunk, index) => exposedChunkIds[index] !== chunk.chunk_id)) failures.push(`${publication.id}: live chunk pagination is incomplete or unstable`);
  if (chunkPages.some((response) => response.buffer.length > manifest.bridge.aiAccess.maxPageBytes) || sourcePageResponses.some((response) => response.buffer.length > manifest.bridge.aiAccess.maxPageBytes)) failures.push(`${publication.id}: live retrieval page exceeds configured bound`);
}

if (failures.length) {
  console.error(`Live MISSION-133 verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Canonical runtime fidelity: PASS (${records.length} files, ${runtimeBytes} bytes, zero SHA-256 mismatches)`);
  console.log(`Root discovery: PASS (${manifest.publications.length} publications in llms.txt and .ai-discovery.json)`);
  console.log("No-JavaScript acceptance path: PASS (root → publication → AI index → source → chunk → blob)");
  console.log(`Live derivation accuracy: PASS (${sourcesVerified} source pages, ${chunksVerified} chunks)`);
  console.log(`Bounded static retrieval: PASS (${aiFilesVerified} source/chunk pages checked)`);
}

