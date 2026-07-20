import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptHtmlPublication } from "./publication-bridge.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const MANIFEST_PATH = path.join(REPOSITORY_ROOT, "publication-manifest.json");
const OUTPUT_ROOT = path.join(REPOSITORY_ROOT, ".netlify-dist");
const STAGING_ROOT = path.join(REPOSITORY_ROOT, ".netlify-dist.staging");
const BACKUP_ROOT = path.join(REPOSITORY_ROOT, ".netlify-dist.previous");
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const TEXT_EXTENSIONS = new Set([
  ".css", ".htm", ".html", ".js", ".cjs", ".mjs", ".json", ".jsonl",
  ".md", ".markdown", ".svg", ".txt", ".webmanifest", ".xml",
]);

function fail(message) {
  throw new Error(message);
}

function requirePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    fail(`${label} must not have leading or trailing whitespace`);
  }
}

function validateRelativePath(value, label, { singleSegment = false } = {}) {
  requireString(value, label);
  if (value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    fail(`${label} must be a portable relative POSIX path: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`${label} contains an empty or unsafe path segment: ${value}`);
  }
  if (singleSegment && segments.length !== 1) {
    fail(`${label} must contain exactly one path segment: ${value}`);
  }
  if (/^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    fail(`${label} must not be drive-qualified or network-qualified: ${value}`);
  }
  return value;
}

function resolveInside(root, relativePath, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`${label} resolves outside its permitted root: ${relativePath}`);
  }
  return resolved;
}

function normalizeBaseUrl(value) {
  if (value === undefined) return undefined;
  requireString(value, "site.baseUrl");
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("site.baseUrl must be an absolute HTTP or HTTPS URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    fail("site.baseUrl must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    fail("site.baseUrl must not contain credentials, a query, or a fragment");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.href;
}

async function loadManifest() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (error) {
    fail(`Unable to read or parse publication-manifest.json: ${error.message}`);
  }
  requirePlainObject(manifest, "manifest");
  if (manifest.schemaVersion !== 1) fail("schemaVersion must equal 1");
  requirePlainObject(manifest.site, "site");
  requireString(manifest.site.title, "site.title");
  requireString(manifest.site.description, "site.description");
  manifest.site.baseUrl = normalizeBaseUrl(manifest.site.baseUrl);
  if (!Array.isArray(manifest.publications) || manifest.publications.length === 0) {
    fail("publications must be a non-empty array");
  }

  const identifiers = new Set();
  const outputPaths = new Set();
  for (const [index, publication] of manifest.publications.entries()) {
    const label = `publications[${index}]`;
    requirePlainObject(publication, label);
    for (const field of ["id", "path", "title", "description", "entryArtifact", "buildId", "compilerVersion"]) {
      requireString(publication[field], `${label}.${field}`);
    }
    validateRelativePath(publication.id, `${label}.id`, { singleSegment: true });
    validateRelativePath(publication.path, `${label}.path`, { singleSegment: true });
    validateRelativePath(publication.entryArtifact, `${label}.entryArtifact`);
    if (publication.id !== publication.path) {
      fail(`${label}.id and ${label}.path must match exactly to preserve public casing`);
    }
    if (!HASH_PATTERN.test(publication.buildId)) fail(`${label}.buildId must be a lowercase SHA-256 value`);
    if (!VERSION_PATTERN.test(publication.compilerVersion)) fail(`${label}.compilerVersion is invalid`);
    const canonicalId = publication.id.toLowerCase();
    const canonicalPath = publication.path.toLowerCase();
    if (identifiers.has(canonicalId)) fail(`Duplicate publication identifier: ${publication.id}`);
    if (outputPaths.has(canonicalPath)) fail(`Duplicate publication output path: ${publication.path}`);
    identifiers.add(canonicalId);
    outputPaths.add(canonicalPath);
  }
  return manifest;
}

async function assertDirectoryWithoutLinks(directory, label) {
  const rootInfo = await lstat(directory).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) fail(`${label} is missing or is not a real directory`);
  const files = [];
  async function walk(current, relativeDirectory) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      validateRelativePath(relativePath, `${label} member`);
      const absolutePath = resolveInside(directory, relativePath, `${label} member`);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) fail(`${label} contains a rejected symlink: ${relativePath}`);
      if (info.isDirectory()) await walk(absolutePath, relativePath);
      else if (info.isFile()) files.push({ relativePath, absolutePath, size: info.size });
      else fail(`${label} contains a non-regular filesystem object: ${relativePath}`);
    }
  }
  await walk(directory, "");
  return files;
}

function findRootRelativeReferences(text) {
  const patterns = [
    ["HTML attribute", /\b(?:href|src|srcset|action|poster)\s*=\s*["']\s*\/(?!\/)/giu],
    ["CSS url", /url\(\s*["']?\s*\/(?!\/)/giu],
    ["CSS import", /@import\s+(?:url\()?\s*["']\s*\/(?!\/)/giu],
    ["Markdown link", /!?\[[^\]]*\]\(\s*\/(?!\/)/gu],
    ["URL field", /"(?:url|uri|href|src|srcset|action|poster)"\s*:\s*"\/(?!\/)/giu],
  ];
  return patterns.flatMap(([kind, pattern]) => [...text.matchAll(pattern)].map((match) => ({ kind, index: match.index })));
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (text.charCodeAt(cursor) === 10) line += 1;
  return line;
}

async function auditSubpathCompatibility(files, publicationId) {
  const problems = [];
  for (const file of files) {
    const extension = path.extname(file.relativePath).toLowerCase();
    const buffer = await readFile(file.absolutePath);
    const appearsTextual = TEXT_EXTENSIONS.has(extension) || (!extension && !buffer.includes(0));
    if (!appearsTextual) continue;
    const text = buffer.toString("utf8");
    for (const match of findRootRelativeReferences(text)) {
      problems.push(`${publicationId}/${file.relativePath}:${lineNumberAt(text, match.index)} (${match.kind})`);
    }
  }
  if (problems.length > 0) {
    fail(`Subpath compatibility failed for ${publicationId}:\n${problems.join("\n")}`);
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function copyAndVerify(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const [sourceBytes, destinationBytes] = await Promise.all([readFile(source), readFile(destination)]);
  const sourceHash = sha256(sourceBytes);
  const destinationHash = sha256(destinationBytes);
  if (sourceBytes.length !== destinationBytes.length || sourceHash !== destinationHash) {
    fail(`Byte-fidelity verification failed while copying ${source}`);
  }
  return { bytes: sourceBytes.length, sha256: sourceHash };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function renderPortal(manifest) {
  const cards = manifest.publications.map((publication) => `
      <article>
        <h2><a href="${encodeURI(publication.path)}/">${escapeHtml(publication.title)}</a></h2>
        <p>${escapeHtml(publication.description)}</p>
        <dl><dt>Identifier</dt><dd><code>${escapeHtml(publication.id)}</code></dd><dt>Compiler</dt><dd>${escapeHtml(publication.compilerVersion)}</dd></dl>
      </article>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(manifest.site.title)}</title>
  <meta name="description" content="${escapeHtml(manifest.site.description)}">
  <style>
    :root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}body{max-width:72rem;margin:auto;padding:3rem 1.25rem}header{margin-bottom:3rem}main{display:grid;gap:1.25rem;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))}article{border:1px solid #8888;border-radius:.75rem;padding:1.25rem}h1,h2{line-height:1.15}dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem}dt{font-weight:600}dd{margin:0}a{color:inherit}
  </style>
</head>
<body>
  <header><h1>${escapeHtml(manifest.site.title)}</h1><p>${escapeHtml(manifest.site.description)}</p></header>
  <main>${cards}
  </main>
</body>
</html>
`;
}

function renderPublication(publication, site, adaptation) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(publication.title)} — ${escapeHtml(site.title)}</title>
  <meta name="description" content="${escapeHtml(publication.description)}">
  <style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}body{max-width:50rem;margin:auto;padding:3rem 1.25rem}a{color:inherit}dt{font-weight:600}dd{margin:0 0 1rem}code{overflow-wrap:anywhere}</style>
</head>
<body>
  <nav><a href="../">← All publications</a></nav>
  <main>
    <h1>${escapeHtml(publication.title)}</h1>
    <p>${escapeHtml(publication.description)}</p>
    <dl>
      <dt>Identifier</dt><dd><code>${escapeHtml(publication.id)}</code></dd>
      <dt>Build ID</dt><dd><code>${escapeHtml(publication.buildId)}</code></dd>
      <dt>Compiler version</dt><dd>${escapeHtml(publication.compilerVersion)}</dd>
    </dl>
    <p class="actions"><a href="${encodeURI(adaptation.entryPath)}">Explore compiler runtime</a> · <a href="${encodeURI(publication.entryArtifact)}">Open primary publication artifact</a></p>
    <p><small>The Runtime Explorer is a derived presentation. The compiler artifacts it exposes remain unchanged.</small></p>
  </main>
</body>
</html>
`;
}

function renderSitemap(manifest) {
  const locations = ["", ...manifest.publications.map((publication) => `${publication.path}/`)]
    .map((relative) => `  <url><loc>${escapeHtml(new URL(relative, manifest.site.baseUrl).href)}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>\n`;
}

async function safeRemove(absolutePath, expectedName) {
  if (path.dirname(absolutePath) !== REPOSITORY_ROOT || path.basename(absolutePath) !== expectedName) {
    fail(`Refusing unsafe cleanup target: ${absolutePath}`);
  }
  await rm(absolutePath, { recursive: true, force: true });
}

async function publishStagingDirectory() {
  const outputExists = await stat(OUTPUT_ROOT).then(() => true, () => false);
  await safeRemove(BACKUP_ROOT, ".netlify-dist.previous");
  if (outputExists) await rename(OUTPUT_ROOT, BACKUP_ROOT);
  try {
    await rename(STAGING_ROOT, OUTPUT_ROOT);
  } catch (error) {
    if (outputExists) await rename(BACKUP_ROOT, OUTPUT_ROOT).catch(() => {});
    throw error;
  }
  if (outputExists) await safeRemove(BACKUP_ROOT, ".netlify-dist.previous");
}

async function main() {
  const manifest = await loadManifest();
  await safeRemove(STAGING_ROOT, ".netlify-dist.staging");
  await mkdir(STAGING_ROOT);
  const copyEvidence = [];
  try {
    for (const publication of manifest.publications) {
      const sourceDirectory = resolveInside(REPOSITORY_ROOT, publication.path, `${publication.id} source`);
      const files = await assertDirectoryWithoutLinks(sourceDirectory, publication.id);
      if (files.some((file) => file.relativePath.toLowerCase() === "index.html")) {
        fail(`${publication.id} contains index.html, which collides with the assembly-owned wrapper`);
      }
      const entryPath = resolveInside(sourceDirectory, publication.entryArtifact, `${publication.id} entryArtifact`);
      const entryInfo = await lstat(entryPath).catch(() => null);
      if (!entryInfo?.isFile() || entryInfo.isSymbolicLink()) fail(`${publication.id} entryArtifact is missing or unsafe`);
      const packageManifest = JSON.parse(await readFile(path.join(sourceDirectory, "manifest.json"), "utf8"));
      if (packageManifest.build_id !== publication.buildId) fail(`${publication.id} buildId does not match its package manifest`);
      if (packageManifest.compiler_version !== publication.compilerVersion) fail(`${publication.id} compilerVersion does not match its package manifest`);
      await auditSubpathCompatibility(files, publication.id);

      const destinationDirectory = resolveInside(STAGING_ROOT, publication.path, `${publication.id} output`);
      for (const file of files) {
        const destination = resolveInside(destinationDirectory, file.relativePath, `${publication.id} copied output`);
        const evidence = await copyAndVerify(file.absolutePath, destination);
        copyEvidence.push({ publication: publication.id, path: file.relativePath, ...evidence });
      }
      const adaptation = await adaptHtmlPublication({ publication, destinationDirectory });
      await writeFile(path.join(destinationDirectory, "index.html"), renderPublication(publication, manifest.site, adaptation), "utf8");
    }

    const publicCatalogue = {
      schemaVersion: manifest.schemaVersion,
      site: manifest.site,
      publications: manifest.publications,
    };
    await writeFile(path.join(STAGING_ROOT, "index.html"), renderPortal(manifest), "utf8");
    await writeFile(path.join(STAGING_ROOT, "publications.json"), `${JSON.stringify(publicCatalogue, null, 2)}\n`, "utf8");
    const robots = manifest.site.baseUrl
      ? `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", manifest.site.baseUrl).href}\n`
      : "User-agent: *\nAllow: /\n";
    await writeFile(path.join(STAGING_ROOT, "robots.txt"), robots, "utf8");
    if (manifest.site.baseUrl) await writeFile(path.join(STAGING_ROOT, "sitemap.xml"), renderSitemap(manifest), "utf8");
    await publishStagingDirectory();
  } catch (error) {
    await safeRemove(STAGING_ROOT, ".netlify-dist.staging").catch(() => {});
    throw error;
  }

  const copiedBytes = copyEvidence.reduce((total, file) => total + file.bytes, 0);
  console.log(`Manifest valid: ${manifest.publications.length} publications`);
  console.log(`Subpath compatibility: PASS (${copyEvidence.length} source files audited)`);
  console.log(`Byte fidelity: PASS (${copyEvidence.length} files, ${copiedBytes} bytes)`);
  console.log(`Sitemap: ${manifest.site.baseUrl ? "generated" : "deferred (site.baseUrl is not configured)"}`);
  console.log(`Output: ${path.relative(REPOSITORY_ROOT, OUTPUT_ROOT)}`);
}

main().catch((error) => {
  console.error(`Assembly failed: ${error.message}`);
  process.exitCode = 1;
});
