import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destinationRoot = path.join(repositoryRoot, ".netlify-dist");
const failures = [];

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".md", "text/markdown; charset=utf-8"], [".txt", "text/plain; charset=utf-8"],
  [".json", "application/json"], [".jsonl", "application/x-ndjson"], [".css", "text/css; charset=utf-8"], [".js", "application/javascript; charset=utf-8"],
]);

function anchors(text, baseUrl) {
  return [...text.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu)].map((match) => ({
    href: new URL(match[1], baseUrl).href,
    label: match[2].replace(/<[^>]+>/gu, "").trim(),
  }));
}

function markdownLinks(text, baseUrl) {
  return [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)].map((match) => ({ href: new URL(decodeURI(match[2]), baseUrl).href, label: match[1] }));
}

function selectLink(links, labelPattern, context) {
  const link = links.find((item) => labelPattern.test(item.label));
  if (!link) throw new Error(`${context}: no link matching ${labelPattern}`);
  return link.href;
}

async function retrieve(url, expectedPattern, label) {
  const response = await fetch(url, { headers: { "user-agent": "MISSION-133-static-reader/1.0", accept: "text/markdown,text/html,application/json,text/plain,*/*" } });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} at ${url}`);
  const text = await response.text();
  if (text.length < 100) throw new Error(`${label}: response is not substantive (${text.length} characters)`);
  if (/Loading certified runtime/iu.test(text)) throw new Error(`${label}: response is only an SPA loading shell`);
  if (expectedPattern && !expectedPattern.test(text)) throw new Error(`${label}: expected static content is absent`);
  return { text, url: response.url, contentType: response.headers.get("content-type") };
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    const decoded = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    let target = path.resolve(destinationRoot, ...decoded.split("/").filter(Boolean));
    if (target !== destinationRoot && !target.startsWith(`${destinationRoot}${path.sep}`)) throw new Error("unsafe path");
    const info = await stat(target).catch(() => null);
    if (info?.isDirectory()) target = path.join(target, "index.html");
    const buffer = await readFile(target);
    response.writeHead(200, { "content-type": contentTypes.get(path.extname(target).toLowerCase()) ?? "application/octet-stream" });
    response.end(buffer);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const rootUrl = `http://127.0.0.1:${address.port}/`;
try {
  const llms = await retrieve(new URL("llms.txt", rootUrl), /BUILD-015[\s\S]+Preferred AI context/u, "llms.txt");
  const rootDiscovery = await retrieve(new URL(".ai-discovery.json", rootUrl), /matrix\.publication-bridge\.root-discovery\/v1/u, "root discovery");
  JSON.parse(rootDiscovery.text);

  const portal = await retrieve(rootUrl, /BUILD-015/u, "Shade root");
  const publicationUrl = selectLink(anchors(portal.text, portal.url), /EMMI Operational Knowledge|BUILD-015/u, "Shade root");
  const publication = await retrieve(publicationUrl, /Open AI-readable publication/u, "BUILD-015 landing page");
  const aiIndexUrl = selectLink(anchors(publication.text, publication.url), /Open AI-readable publication/u, "BUILD-015 landing page");
  const index = await retrieve(aiIndexUrl, /deterministic, derived, read-only representation[\s\S]+Source count: 76/u, "AI Level 1 index");
  const indexLinks = markdownLinks(index.text, index.url);
  const contextUrl = selectLink(indexLinks, /Preferred AI context/u, "AI index");
  await retrieve(contextUrl, /^# Publication Identity[\s\S]+^# Raw Authoritative Artifacts/mu, "preferred AI context");
  const sourceDirectoryUrl = selectLink(indexLinks, /Source directory/u, "AI index");
  const sourceDirectory = await retrieve(sourceDirectoryUrl, /Sources represented: 76/u, "source directory");
  const sourceUrl = selectLink(markdownLinks(sourceDirectory.text, sourceDirectory.url), /EMMI|BUILD-015|MISSION/u, "source directory");
  const source = await retrieve(sourceUrl, /Stable source identifier:[\s\S]+Certified source text/u, "individual source");
  const sourceLinks = markdownLinks(source.text, source.url);
  const chunkUrl = selectLink(sourceLinks, /^chk:/u, "individual source");
  await retrieve(chunkUrl, /^## chk:[\s\S]+Source:/mu, "associated chunk");
  const blobUrl = selectLink(sourceLinks, /Unchanged authoritative blob/u, "individual source");
  await retrieve(blobUrl, /BUILD-015|EMMI/u, "unchanged blob");
  await retrieve(selectLink(indexLinks, /^Validation$/u, "AI index"), /Valid: \*\*true\*\*/u, "validation view");
  await retrieve(selectLink(indexLinks, /^Certification$/u, "AI index"), /Valid: \*\*true\*\*/u, "certification view");
  const rawManifest = await retrieve(selectLink(indexLinks, /Raw manifest/u, "AI index"), /mkc\.manifest\/v1/u, "raw manifest");
  JSON.parse(rawManifest.text);
  const rawCatalog = await retrieve(selectLink(indexLinks, /Raw catalog/u, "AI index"), /mkc\.catalog\/v1/u, "raw catalog");
  JSON.parse(rawCatalog.text);
} catch (error) {
  failures.push(error.message);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

if (failures.length) {
  console.error("Static HTTP acceptance failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Static HTTP retrievability: PASS (no JavaScript or browser state)");
  console.log("External-reader acceptance path: PASS (root → publication → AI index → source → chunk → blob)");
  console.log("Validation, certification, and raw authority access: PASS");
}

