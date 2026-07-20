import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ADAPTER_ID = "matrix-publication-bridge/ai-access";
const ADAPTER_VERSION = "1.0.0";
const AUTHORITY_NOTICE = "This is a deterministic, derived, read-only representation. The unchanged compiler runtime remains authoritative.";

function fail(message) {
  throw new Error(`AI Access Adapter: ${message}`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    fail(`${label} is not valid UTF-8 JSON: ${error.message}`);
  }
}

function parseJsonl(buffer, label) {
  return buffer.toString("utf8").split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fail(`${label}:${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function absolute(baseUrl, relativePath) {
  return new URL(relativePath, baseUrl).href;
}

function sourceFilename(sourceId) {
  const safe = sourceId.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!safe) fail(`source identifier cannot form a safe filename: ${sourceId}`);
  return `${safe}.md`;
}

function pageName(index) {
  return `page-${String(index + 1).padStart(4, "0")}.md`;
}

function chunkAnchor(chunkId) {
  return `chunk-${chunkId.replace(/[^A-Za-z0-9_-]+/gu, "-")}`;
}

function markdownLink(label, href) {
  return `[${String(label).replace(/\]/gu, "\\]")}](${encodeURI(href)})`;
}

function tableCell(value) {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function chunksOf(records, size) {
  const pages = [];
  for (let index = 0; index < records.length; index += size) pages.push(records.slice(index, index + size));
  return pages.length ? pages : [[]];
}

function pageNavigation(indexHref, pageIndex, pageCount) {
  const parts = [markdownLink("Index", indexHref)];
  if (pageIndex > 0) parts.push(markdownLink("Previous", pageName(pageIndex - 1)));
  if (pageIndex + 1 < pageCount) parts.push(markdownLink("Next", pageName(pageIndex + 1)));
  parts.push(`Page ${pageIndex + 1} of ${pageCount}`);
  return `${parts.join(" · ")}\n\n`;
}

function staticIndexHtml(publication, facts, links) {
  const list = links.map(([label, href]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI-readable publication — ${escapeHtml(publication.title)}</title></head>
<body>
  <main>
    <p><a href="../../../">← Publication landing page</a></p>
    <h1>${escapeHtml(publication.title)} — AI Access Level 1</h1>
    <p><strong>${escapeHtml(AUTHORITY_NOTICE)}</strong></p>
    <dl>
      <dt>Identifier</dt><dd><code>${escapeHtml(publication.id)}</code></dd>
      <dt>Build ID</dt><dd><code>${escapeHtml(facts.manifest.build_id)}</code></dd>
      <dt>Compiler</dt><dd>${escapeHtml(facts.manifest.compiler_version)}</dd>
      <dt>Sources</dt><dd>${facts.sources.length}</dd><dt>Chunks</dt><dd>${facts.chunks.length}</dd>
      <dt>Validation</dt><dd>${facts.validation.valid ? "valid" : "invalid"}</dd>
      <dt>Certification</dt><dd>${facts.certification?.valid ? "valid" : "not supplied by this runtime"}</dd>
    </dl>
    <h2>Static retrieval routes</h2><ul>${list}</ul>
    <p>The preferred machine-readable entry point is <a href="index.md">index.md</a>. The self-contained assistant context is <a href="context.md">context.md</a>.</p>
  </main>
</body>
</html>
`;
}

async function loadFacts(sourceDirectory, publication) {
  const required = ["manifest.json", "catalog.json", "graph.json", "lexical-index.json", "chunks.jsonl", "corpus.jsonl", "validation.json"];
  const buffers = Object.fromEntries(await Promise.all(required.map(async (name) => [name, await readFile(path.join(sourceDirectory, name)).catch(() => fail(`${publication.id} is missing ${name}`))])));
  const manifest = parseJson(buffers["manifest.json"], "manifest.json");
  const catalog = parseJson(buffers["catalog.json"], "catalog.json");
  const graph = parseJson(buffers["graph.json"], "graph.json");
  const lexical = parseJson(buffers["lexical-index.json"], "lexical-index.json");
  const chunks = parseJsonl(buffers["chunks.jsonl"], "chunks.jsonl");
  const corpus = parseJsonl(buffers["corpus.jsonl"], "corpus.jsonl");
  const validation = parseJson(buffers["validation.json"], "validation.json");
  const certificationBuffer = await readFile(path.join(sourceDirectory, "merged-document-certification.json")).catch(() => null);
  const certification = certificationBuffer ? parseJson(certificationBuffer, "merged-document-certification.json") : null;
  if (manifest.schema !== "mkc.manifest/v1") fail(`${publication.id} uses unsupported manifest schema ${manifest.schema}`);
  if (manifest.build_id !== publication.buildId) fail(`${publication.id} build ID differs from bridge declaration`);
  if (!validation.valid) fail(`${publication.id} compiler validation is not valid`);
  const sources = requireArray(manifest.documents, "manifest.documents");
  const entries = requireArray(catalog.entries, "catalog.entries");
  const nodes = requireArray(graph.nodes, "graph.nodes");
  const edges = requireArray(graph.edges, "graph.edges");
  if (sources.length !== entries.length || sources.length !== corpus.length) fail(`${publication.id} source inventories disagree`);
  const sourceIds = new Set(sources.map((item) => item.source_id));
  if (sourceIds.size !== sources.length) fail(`${publication.id} contains duplicate source identifiers`);
  if (new Set(entries.map((item) => item.source_id)).size !== sources.length || entries.some((item) => !sourceIds.has(item.source_id))) fail(`${publication.id} catalog source coverage is incomplete`);
  if (new Set(corpus.map((item) => item.source_id)).size !== sources.length || corpus.some((item) => !sourceIds.has(item.source_id))) fail(`${publication.id} corpus source coverage is incomplete`);
  const chunkIds = new Set(chunks.map((item) => item.chunk_id));
  if (chunkIds.size !== chunks.length || chunks.some((item) => !sourceIds.has(item.source_id))) fail(`${publication.id} chunk identities or source references are invalid`);
  const catalogChunkIds = entries.flatMap((item) => item.chunk_ids ?? []);
  if (catalogChunkIds.length !== chunks.length || new Set(catalogChunkIds).size !== chunks.length || catalogChunkIds.some((id) => !chunkIds.has(id))) fail(`${publication.id} catalog chunk coverage is incomplete`);
  return { manifest, catalog, graph, lexical, chunks, corpus, validation, certification, sources, entries, nodes, edges, sourceIds, chunkIds };
}

function routeLinks(publicationBase) {
  return [
    ["Preferred AI context", "context.md"], ["Manifest view", "manifest.md"], ["Catalog view", "catalog.md"],
    ["Graph view", "graph.md"], ["Lexical index view", "lexical-index.md"], ["Chunk directory", "chunks/index.md"],
    ["Source directory", "corpus/index.md"], ["Validation", "validation.md"], ["Certification", "certification.md"],
    ["Blob directory", "blobs.md"], ["Merged documents", "merged-documents.md"],
    ["Raw manifest", `${publicationBase}manifest.json`], ["Raw catalog", `${publicationBase}catalog.json`],
    ["Raw graph", `${publicationBase}graph.json`], ["Raw lexical index", `${publicationBase}lexical-index.json`],
    ["Raw chunks", `${publicationBase}chunks.jsonl`], ["Raw corpus", `${publicationBase}corpus.jsonl`],
  ];
}

async function writeProduct(root, relativePath, content, products, maxPageBytes, bounded = false) {
  const buffer = Buffer.from(content, "utf8");
  if (bounded && buffer.length > maxPageBytes) fail(`${relativePath} exceeds configured ${maxPageBytes}-byte page bound (${buffer.length})`);
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer);
  products.push({ path: `_bridge/ai/v1/${relativePath}`, bytes: buffer.length, sha256: sha256(buffer) });
}

export async function adaptAiPublication({ publication, sourceDirectory, destinationDirectory, capability, siteBaseUrl }) {
  if (!capability?.enabled || capability.level !== 1) fail(`${publication.id} requires enabled Level 1 capability`);
  if (capability.preferredFormat !== "markdown" || capability.includeSourcePages !== true || capability.includeChunkPages !== true) fail(`${publication.id} has an incomplete Level 1 capability`);
  if (!Number.isInteger(capability.pageSize) || capability.pageSize < 1) fail("pageSize must be a positive integer");
  if (!Number.isInteger(capability.maxPageBytes) || capability.maxPageBytes < 4096) fail("maxPageBytes must be an integer of at least 4096");
  const facts = await loadFacts(sourceDirectory, publication);
  const root = path.join(destinationDirectory, "_bridge", "ai", "v1");
  const products = [];
  const publicationUrl = absolute(siteBaseUrl, `${publication.path}/`);
  const adapterUrl = absolute(siteBaseUrl, `${publication.path}/_bridge/ai/v1/`);
  const relativeRaw = "../../../";
  const links = routeLinks(relativeRaw);
  const groupBy = (records, selector) => records.reduce((groups, record) => {
    const key = selector(record);
    (groups[key] ??= []).push(record);
    return groups;
  }, {});
  const graphNodeKinds = groupBy(facts.nodes, (node) => node.kind ?? "unspecified");
  const graphEdgeKinds = groupBy(facts.edges, (edge) => edge.kind ?? "unspecified");
  const lexicalTerms = Object.entries(facts.lexical.terms ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const certificationStatus = facts.certification?.valid ? "VALID" : "NOT PROVIDED BY RUNTIME";

  const index = `# ${publication.title} — AI Access Level 1

${AUTHORITY_NOTICE}

## Publication identity

- Identifier: \`${publication.id}\`
- Build ID: \`${facts.manifest.build_id}\`
- Compiler version: \`${facts.manifest.compiler_version}\`
- Purpose: ${publication.description}
- Source count: ${facts.sources.length}
- Chunk count: ${facts.chunks.length}
- Graph nodes: ${facts.nodes.length}
- Graph edges: ${facts.edges.length}
- Lexical terms: ${lexicalTerms.length}
- Validation: ${facts.validation.valid ? "VALID" : "INVALID"}
- Certification: ${certificationStatus}

## Retrieval map

${links.map(([label, href]) => `- ${markdownLink(label, href)}`).join("\n")}

## Corpus versus chunks

Corpus pages represent complete individual source records and provide the unchanged certified source text. Chunk pages provide bounded retrieval contexts with stable chunk IDs, source IDs, line intervals, heading paths, and content hashes.

## Retrieving an individual source

Open ${markdownLink("the source directory", "corpus/index.md")}, select the stable source identifier, then follow its chunk and unchanged blob links.

## Citation guidance

Cite the publication identifier and build ID, the source title and stable source ID, the original path, and—when using a bounded context—the chunk ID and line interval. Link to the individual source page or unchanged blob. Derived bridge pages assist retrieval but are not compiler authority.
`;
  await writeProduct(root, "index.md", index, products, capability.maxPageBytes);
  await writeProduct(root, "index.html", staticIndexHtml(publication, facts, links), products, capability.maxPageBytes);

  const sourceDirectoryLines = facts.sources.map((source, indexValue) => {
    const entry = facts.entries.find((item) => item.source_id === source.source_id);
    return `${indexValue + 1}. ${markdownLink(entry?.title ?? source.title ?? source.path, `corpus/${sourceFilename(source.source_id)}`)} — \`${source.source_id}\``;
  }).join("\n");
  const roots = [...new Set(facts.catalog.roots ?? facts.sources.map((item) => item.root).filter(Boolean))].sort();
  const context = `# Publication Identity

- Title: ${publication.title}
- Identifier: \`${publication.id}\`
- Build ID: \`${facts.manifest.build_id}\`
- Compiler version: \`${facts.manifest.compiler_version}\`
- Canonical AI entry: ${adapterUrl}index.md

# Authority and Provenance

${AUTHORITY_NOTICE}

The manifest records ${facts.sources.length} sources. Content-addressed blobs preserve source bytes and the manifest supplies source identifiers, paths, SHA-256 values, sizes, media types, and encoding facts.

# Runtime Status

- Compiler validation: ${facts.validation.valid ? "VALID" : "INVALID"}
- Certification: ${certificationStatus}
- Chunks: ${facts.chunks.length}
- Graph nodes: ${facts.nodes.length}
- Graph edges: ${facts.edges.length}
- Lexical terms: ${lexicalTerms.length}

# Publication Summary

The runtime publishes ${facts.sources.length} source records, ${facts.chunks.length} bounded chunks, ${facts.edges.length} graph edges, and ${lexicalTerms.length} deterministic lexical terms. No semantic summary has been generated by this adapter.

# Knowledge Domains

${roots.length ? roots.map((item) => `- \`${item}\``).join("\n") : "- No roots declared by the runtime."}

# Source Directory

${sourceDirectoryLines}

# Retrieval Routes

- Begin with ${markdownLink("the source directory", "corpus/index.md")} for complete source records.
- Use ${markdownLink("the chunk directory", "chunks/index.md")} for bounded contexts.
- Use ${markdownLink("the lexical directory", "lexical-index.md")} to locate chunk IDs by exact indexed term.
- Use ${markdownLink("the graph directory", "graph.md")} to inspect compiler-recorded relationships.

# Validation and Certification

- ${markdownLink("Validation representation", "validation.md")}
- ${markdownLink("Certification representation", "certification.md")}

# Citation and Traceability Rules

Include publication identifier \`${publication.id}\`, build ID \`${facts.manifest.build_id}\`, stable source ID, original path, and blob SHA-256. For chunk citations also include the chunk ID and one-based line interval. Cite the source page or unchanged blob; do not present this adapter as compiler authority.

# Raw Authoritative Artifacts

${links.filter(([, href]) => href.startsWith(relativeRaw)).map(([label, href]) => `- ${markdownLink(label, href)}`).join("\n")}
`;
  await writeProduct(root, "context.md", context, products, capability.maxPageBytes);

  const manifestLines = facts.sources.map((source, indexValue) => `| ${indexValue + 1} | \`${tableCell(source.source_id)}\` | ${tableCell(source.path)} | \`${source.sha256}\` | ${source.size} |`).join("\n");
  await writeProduct(root, "manifest.md", `# Manifest

${AUTHORITY_NOTICE}

- Schema: \`${facts.manifest.schema}\`
- Build ID: \`${facts.manifest.build_id}\`
- Compiler: \`${facts.manifest.compiler_version}\`
- Configuration SHA-256: \`${facts.manifest.config_sha256 ?? "not declared"}\`
- Sources: ${facts.sources.length}
- Chunks: ${facts.chunks.length}
- Edges declared by manifest: ${facts.manifest.edge_count ?? "not declared"}
- ${markdownLink("Raw authoritative manifest", `${relativeRaw}manifest.json`)}

| Order | Source ID | Original path | Blob SHA-256 | Bytes |
|---:|---|---|---|---:|
${manifestLines}
`, products, capability.maxPageBytes);

  const catalogLines = facts.entries.map((entry, indexValue) => `| ${indexValue + 1} | ${markdownLink(entry.title ?? entry.path, `corpus/${sourceFilename(entry.source_id)}`)} | \`${tableCell(entry.source_id)}\` | ${entry.chunk_ids?.length ?? 0} |`).join("\n");
  await writeProduct(root, "catalog.md", `# Catalog

${AUTHORITY_NOTICE}

The catalog is the compiler's source-to-chunk routing layer. ${markdownLink("Open raw catalog", `${relativeRaw}catalog.json`)}.

| Order | Source | Source ID | Chunks |
|---:|---|---|---:|
${catalogLines}
`, products, capability.maxPageBytes);

  const chunkPages = chunksOf(facts.chunks, capability.pageSize);
  const chunkIndexRows = chunkPages.map((page, indexValue) => `- ${markdownLink(`Page ${indexValue + 1}`, `page-${String(indexValue + 1).padStart(4, "0")}.md`)} — ${page.length} chunks; ${page[0]?.chunk_id ?? "empty"} through ${page.at(-1)?.chunk_id ?? "empty"}`).join("\n");
  await writeProduct(root, "chunks/index.md", `# Chunk Directory

${AUTHORITY_NOTICE}

- Total chunks: ${facts.chunks.length}
- Deterministic page size: ${capability.pageSize}
- Pages: ${chunkPages.length}
- ${markdownLink("Raw authoritative chunks stream", "../../../../chunks.jsonl")}

${chunkIndexRows}
`, products, capability.maxPageBytes);
  const chunkLocations = new Map();
  for (const [pageIndex, page] of chunkPages.entries()) {
    const records = page.map((chunk) => {
      chunkLocations.set(chunk.chunk_id, { page: pageName(pageIndex), anchor: chunkAnchor(chunk.chunk_id) });
      return `<a id="${chunkAnchor(chunk.chunk_id)}"></a>
## ${chunk.chunk_id}

- Source: ${markdownLink(chunk.source_id, `../corpus/${sourceFilename(chunk.source_id)}`)}
- Ordinal: ${chunk.ordinal}
- Lines: ${chunk.start_line}–${chunk.end_line}
- Heading path: ${(chunk.heading_path ?? []).map((item) => `\`${item}\``).join(" → ") || "not declared"}
- Text SHA-256: \`${chunk.text_sha256}\`

${chunk.text}
`;
    }).join("\n");
    await writeProduct(root, `chunks/${pageName(pageIndex)}`, `# Chunks — Page ${pageIndex + 1}

${AUTHORITY_NOTICE}

${pageNavigation("index.md", pageIndex, chunkPages.length)}${records}
${pageNavigation("index.md", pageIndex, chunkPages.length)}`, products, capability.maxPageBytes, true);
  }

  const edgesBySource = new Map();
  for (const edge of facts.edges) {
    for (const identity of [edge.source, edge.target]) {
      if (!edgesBySource.has(identity)) edgesBySource.set(identity, []);
      edgesBySource.get(identity).push(edge);
    }
  }
  const entryBySource = new Map(facts.entries.map((entry) => [entry.source_id, entry]));
  for (const [indexValue, source] of facts.sources.entries()) {
    const entry = entryBySource.get(source.source_id);
    const related = edgesBySource.get(source.source_id) ?? [];
    const sourceChunks = entry.chunk_ids ?? [];
    const chunkLinks = sourceChunks.map((id) => {
      const location = chunkLocations.get(id);
      if (!location) fail(`${publication.id} cannot locate chunk ${id}`);
      return `- ${markdownLink(id, `../chunks/${location.page}#${location.anchor}`)}`;
    }).join("\n") || "- No chunks declared.";
    const relationshipLines = related.map((edge) => `- \`${edge.kind}\`: \`${edge.source}\` → \`${edge.target}\`; resolved: ${edge.resolved}; evidence line: ${edge.evidence_line ?? "not declared"}; evidence: \`${tableCell(edge.evidence)}\``).join("\n") || "- No graph relationships recorded for this source identifier.";
    const blobRelative = `../../../../blobs/sha256/${source.sha256.slice(0, 2)}/${source.sha256}`;
    const blob = await readFile(path.join(sourceDirectory, "blobs", "sha256", source.sha256.slice(0, 2), source.sha256)).catch(() => fail(`${publication.id} is missing blob ${source.sha256}`));
    if (sha256(blob) !== source.sha256 || blob.length !== source.size) fail(`${publication.id} blob fidelity failed for ${source.path}`);
    if (source.text_encoding !== "utf-8") fail(`${publication.id} Level 1 source text requires UTF-8: ${source.path}`);
    const sourceText = blob.toString("utf8");
    const page = `# ${entry.title ?? source.title ?? source.path}

${AUTHORITY_NOTICE}

## Source identity and traceability

- Stable source identifier: \`${source.source_id}\`
- Source order: ${indexValue + 1} of ${facts.sources.length}
- Constitutional or publication status: not declared by the compiler runtime
- Original path: \`${source.path}\`
- Media type: \`${source.media_type}\`
- Text encoding: \`${source.text_encoding}\`
- Blob SHA-256: \`${source.sha256}\`
- Byte length: ${source.size}
- ${markdownLink("Unchanged authoritative blob", blobRelative)}
- ${markdownLink("Catalog", "../catalog.md")}
- ${markdownLink("Publication index", "../index.md")}

## Associated chunks

${chunkLinks}

## Graph relationships

${relationshipLines}

## Certified source text

<!-- MKC-BLOB-TEXT-BEGIN sha256=${source.sha256} -->
${sourceText}${sourceText.endsWith("\n") ? "" : "\n"}<!-- MKC-BLOB-TEXT-END -->
`;
    await writeProduct(root, `corpus/${sourceFilename(source.source_id)}`, page, products, capability.maxPageBytes, true);
  }
  await writeProduct(root, "corpus/index.md", `# Source Directory

${AUTHORITY_NOTICE}

- Sources represented: ${facts.sources.length}
- ${markdownLink("Raw authoritative corpus stream", "../../../../corpus.jsonl")}
- ${markdownLink("Catalog view", "../catalog.md")}

${sourceDirectoryLines.replaceAll("corpus/", "")}
`, products, capability.maxPageBytes);

  const edgeKindRows = Object.entries(graphEdgeKinds).sort(([a], [b]) => a.localeCompare(b)).map(([kind, records]) => `| \`${kind}\` | ${records.length} |`).join("\n");
  const nodeKindRows = Object.entries(graphNodeKinds).sort(([a], [b]) => a.localeCompare(b)).map(([kind, records]) => `| \`${kind}\` | ${records.length} |`).join("\n");
  const graphPages = chunksOf(facts.edges, capability.pageSize);
  const graphPageLinks = graphPages.map((page, indexValue) => `- ${markdownLink(`Relationships page ${indexValue + 1}`, `graph-pages/${pageName(indexValue)}`)} — ${page.length} edges`).join("\n");
  await writeProduct(root, "graph.md", `# Graph

${AUTHORITY_NOTICE}

- Nodes: ${facts.nodes.length}
- Edges: ${facts.edges.length}
- Unresolved edges: ${facts.edges.filter((edge) => !edge.resolved).length}
- ${markdownLink("Raw authoritative graph", `${relativeRaw}graph.json`)}

## Node types

| Type | Count |
|---|---:|
${nodeKindRows}

## Edge types

| Type | Count |
|---|---:|
${edgeKindRows}

## Deterministic relationship pages

${graphPageLinks}
`, products, capability.maxPageBytes);
  for (const [pageIndex, page] of graphPages.entries()) {
    const rows = page.map((edge) => `| \`${edge.edge_id}\` | \`${tableCell(edge.kind)}\` | \`${tableCell(edge.source)}\` | \`${tableCell(edge.target)}\` | ${edge.resolved} | ${edge.evidence_line ?? ""} | \`${tableCell(edge.evidence)}\` |`).join("\n");
    await writeProduct(root, `graph-pages/${pageName(pageIndex)}`, `# Graph Relationships — Page ${pageIndex + 1}

${AUTHORITY_NOTICE}

${pageNavigation("../graph.md", pageIndex, graphPages.length)}| Edge ID | Type | Source | Target | Resolved | Evidence line | Evidence |
|---|---|---|---|---|---:|---|
${rows}

${pageNavigation("../graph.md", pageIndex, graphPages.length)}`, products, capability.maxPageBytes, true);
  }

  const lexicalPages = chunksOf(lexicalTerms, capability.pageSize);
  const lexicalLinks = lexicalPages.map((page, indexValue) => `- ${markdownLink(`Terms page ${indexValue + 1}`, `lexical-pages/${pageName(indexValue)}`)} — ${page.length} terms; \`${page[0]?.[0] ?? ""}\` through \`${page.at(-1)?.[0] ?? ""}\``).join("\n");
  await writeProduct(root, "lexical-index.md", `# Lexical Index

${AUTHORITY_NOTICE}

- Schema: \`${facts.lexical.schema}\`
- Tokenizer: \`${facts.lexical.tokenizer}\`
- Terms: ${lexicalTerms.length}
- Deterministic page size: ${capability.pageSize}
- ${markdownLink("Raw authoritative lexical index", `${relativeRaw}lexical-index.json`)}

${lexicalLinks}
`, products, capability.maxPageBytes);
  for (const [pageIndex, page] of lexicalPages.entries()) {
    const termSections = page.map(([term, postings]) => {
      const postingLines = Object.entries(postings).sort(([a], [b]) => a.localeCompare(b)).map(([chunkId, positions]) => {
        const location = chunkLocations.get(chunkId);
        if (!location) fail(`${publication.id} lexical term ${term} refers to unknown chunk ${chunkId}`);
        return `- ${markdownLink(chunkId, `../chunks/${location.page}#${location.anchor}`)} — positions: ${positions.join(", ")}`;
      }).join("\n");
      return `## ${term}\n\n${postingLines}`;
    }).join("\n\n");
    await writeProduct(root, `lexical-pages/${pageName(pageIndex)}`, `# Lexical Terms — Page ${pageIndex + 1}

${AUTHORITY_NOTICE}

${pageNavigation("../lexical-index.md", pageIndex, lexicalPages.length)}${termSections}

${pageNavigation("../lexical-index.md", pageIndex, lexicalPages.length)}`, products, capability.maxPageBytes, true);
  }

  await writeProduct(root, "validation.md", `# Validation

${AUTHORITY_NOTICE}

- Schema: \`${facts.validation.schema}\`
- Build ID: \`${facts.validation.build_id}\`
- Valid: **${facts.validation.valid}**
- Errors: ${facts.validation.errors?.length ?? 0}
- ${markdownLink("Raw authoritative validation record", `${relativeRaw}validation.json`)}

## Checks

${Object.entries(facts.validation.checks ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, result]) => `- \`${name}\`: ${result}`).join("\n") || "- No individual checks declared."}
`, products, capability.maxPageBytes);

  const certificationBody = facts.certification ? `- Schema: \`${facts.certification.schema}\`
- Build ID: \`${facts.certification.build_id}\`
- Valid: **${facts.certification.valid}**
- Certified documents: ${facts.certification.documents?.length ?? 0}
- ${markdownLink("Raw authoritative certification record", `${relativeRaw}merged-document-certification.json`)}

${(facts.certification.documents ?? []).map((document) => `## ${document.title ?? document.id}\n\n- ID: \`${document.id}\`\n- File: ${markdownLink(document.filename, `${relativeRaw}merged-documents/${document.filename}`)}\n- SHA-256: \`${document.sha256}\`\n- Sources: ${document.sources?.length ?? 0}`).join("\n\n")}` : "The runtime does not publish a separate `merged-document-certification.json` artifact. No certification has been inferred by this adapter.";
  await writeProduct(root, "certification.md", `# Certification

${AUTHORITY_NOTICE}

${certificationBody}
`, products, capability.maxPageBytes);

  const blobRows = facts.sources.map((source, indexValue) => `| ${indexValue + 1} | \`${source.source_id}\` | ${markdownLink(source.sha256, `${relativeRaw}blobs/sha256/${source.sha256.slice(0, 2)}/${source.sha256}`)} | ${source.size} |`).join("\n");
  await writeProduct(root, "blobs.md", `# Content-addressed Blobs

${AUTHORITY_NOTICE}

| Order | Source ID | Unchanged blob | Bytes |
|---:|---|---|---:|
${blobRows}
`, products, capability.maxPageBytes);

  const primary = facts.manifest.primary_outputs ?? [];
  await writeProduct(root, "merged-documents.md", `# Merged Documents

${AUTHORITY_NOTICE}

${primary.length ? primary.map((item) => `- \`${item.id}\`: ${markdownLink(item.path, `${relativeRaw}${item.path}`)} — SHA-256 \`${item.sha256}\``).join("\n") : `The runtime manifest declares no primary outputs. The bridge publication declaration points to ${markdownLink(publication.entryArtifact, `${relativeRaw}${publication.entryArtifact}`)}; this adapter does not promote it to compiler-certified status.`}
`, products, capability.maxPageBytes);

  const discovery = {
    schema: "matrix.publication-bridge.ai-discovery/v1",
    adapter: { id: ADAPTER_ID, version: ADAPTER_VERSION, level: 1, authoritative: false },
    publication: {
      id: publication.id, title: publication.title, description: publication.description, build_id: facts.manifest.build_id,
      compiler_version: facts.manifest.compiler_version, publication_url: publicationUrl,
    },
    preferred_entry: absolute(adapterUrl, "context.md"),
    index: absolute(adapterUrl, "index.md"),
    html_index: absolute(adapterUrl, "index.html"),
    runtime_explorer: absolute(publicationUrl, "_bridge/html/"),
    views: { validation: absolute(adapterUrl, "validation.md"), certification: absolute(adapterUrl, "certification.md"), sources: absolute(adapterUrl, "corpus/index.md"), chunks: absolute(adapterUrl, "chunks/index.md") },
    raw: Object.fromEntries([["manifest", "manifest.json"], ["catalog", "catalog.json"], ["graph", "graph.json"], ["lexical_index", "lexical-index.json"], ["chunks", "chunks.jsonl"], ["corpus", "corpus.jsonl"], ["validation", "validation.json"], ...(facts.certification ? [["certification", "merged-document-certification.json"]] : [])].map(([key, value]) => [key, absolute(publicationUrl, value)])),
    counts: { sources: facts.sources.length, chunks: facts.chunks.length, graph_nodes: facts.nodes.length, graph_edges: facts.edges.length, lexical_terms: lexicalTerms.length },
    status: { validation: facts.validation.valid ? "valid" : "invalid", certification: facts.certification?.valid ? "valid" : "not-provided" },
    authority_notice: AUTHORITY_NOTICE,
  };
  await writeProduct(root, "discovery.json", `${JSON.stringify(discovery, null, 2)}\n`, products, capability.maxPageBytes);
  return { adapterId: ADAPTER_ID, adapterVersion: ADAPTER_VERSION, level: 1, entryPath: "_bridge/ai/v1/index.md", contextPath: "_bridge/ai/v1/context.md", products, discovery };
}

export function renderRootAiDiscovery(manifest, adaptations) {
  const baseUrl = manifest.site.baseUrl;
  return {
    schema: "matrix.publication-bridge.root-discovery/v1",
    preferred_format: "markdown",
    publications: manifest.publications.map((publication) => {
      const adaptation = adaptations.get(publication.id);
      if (!adaptation) fail(`missing AI adaptation for ${publication.id}`);
      const publicationUrl = absolute(baseUrl, `${publication.path}/`);
      return {
        id: publication.id, title: publication.title, description: publication.description, build_id: publication.buildId,
        publication: publicationUrl, ai_level_1: absolute(baseUrl, `${publication.path}/${adaptation.entryPath}`),
        preferred_context: absolute(baseUrl, `${publication.path}/${adaptation.contextPath}`),
        html_runtime_explorer: absolute(publicationUrl, "_bridge/html/"), raw_manifest: absolute(publicationUrl, "manifest.json"),
        raw_catalog: absolute(publicationUrl, "catalog.json"), validation: absolute(baseUrl, `${publication.path}/_bridge/ai/v1/validation.md`),
        certification: absolute(baseUrl, `${publication.path}/_bridge/ai/v1/certification.md`), primary_publication: absolute(publicationUrl, publication.entryArtifact),
      };
    }),
  };
}

export function renderLlmsTxt(manifest, rootDiscovery) {
  const lines = [`# ${manifest.site.title}`, "", manifest.site.description, "", `AI discovery: ${absolute(manifest.site.baseUrl, ".ai-discovery.json")}`, ""];
  for (const publication of rootDiscovery.publications) {
    lines.push(`## ${publication.title}`, `- Identifier: ${publication.id}`, `- Preferred AI context: ${publication.preferred_context}`, `- AI Level 1 index: ${publication.ai_level_1}`, `- Publication landing page: ${publication.publication}`, `- HTML Runtime Explorer: ${publication.html_runtime_explorer}`, `- Raw manifest: ${publication.raw_manifest}`, `- Raw catalog: ${publication.raw_catalog}`, `- Validation: ${publication.validation}`, `- Certification: ${publication.certification}`, `- Primary publication: ${publication.primary_publication}`, "");
  }
  return `${lines.join("\n")}\n`;
}
