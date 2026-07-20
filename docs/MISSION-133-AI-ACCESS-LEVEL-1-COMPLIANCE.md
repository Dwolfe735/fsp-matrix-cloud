# MISSION-133 — Publication Bridge AI Access Adapter, Level 1 Compliance

## Scope

MISSION-133 adds deterministic discovery, static reading, and grounded traceability to the Publication Bridge. It does not add conversational querying, inference, embeddings, vector search, dynamic APIs, server-side functions, authentication, or write operations.

## Constitutional boundary

- The adapter reads existing MKC publication products through their public file schemas.
- Compiler source is not imported, invoked, or modified.
- Runtime source directories are read-only inputs.
- Every runtime file is copied and verified by byte length and SHA-256 before destination activation.
- All publication-specific AI products are isolated beneath `_bridge/ai/v1/`.
- Root additions are limited to `.ai-discovery.json` and `llms.txt`.
- Destination landing pages contain navigation links only.
- Adapter products do not participate in MKC build identity, compiler validation, certification, or provenance.
- Every adapter surface states that it is derived and that the unchanged runtime remains authoritative.

## Explicit capability

`publication-manifest.json` enables:

```json
{
  "aiAccess": {
    "enabled": true,
    "level": 1,
    "preferredFormat": "markdown",
    "includeSourcePages": true,
    "includeChunkPages": true,
    "pageSize": 25,
    "maxPageBytes": 400000
  }
}
```

Assembly fails when this contract is incomplete, when a publication does not expose the required MKC v1 runtime products, when runtime inventories disagree, when source or chunk coverage is incomplete, when a blob fails its declared digest or size, or when a generated bounded page exceeds the configured byte limit.

## Discovery surfaces

The bridge publishes:

- `/.ai-discovery.json`: structured root discovery for every publication;
- `/llms.txt`: plain-text publication and route discovery;
- `<publication>/_bridge/ai/v1/discovery.json`: publication-specific structured discovery;
- `<publication>/_bridge/ai/v1/index.md`: concise Level 1 retrieval map;
- `<publication>/_bridge/ai/v1/context.md`: preferred fixed-format AI context;
- `<publication>/_bridge/ai/v1/index.html`: substantive non-JavaScript human representation.

Each publication landing page links to the HTML Runtime Explorer, AI-readable publication, primary publication artifact, and raw manifest.

## Static representations

For every supported publication the adapter generates:

- manifest, catalog, graph, lexical-index, validation, certification, blob, and merged-document views;
- one collision-safe Markdown page for every stable source ID;
- exact source text read from and checked against its content-addressed blob;
- stable source order and source-to-chunk routes;
- bounded chunk pages in compiler order;
- bounded relationship pages in graph order;
- bounded lexical term pages in deterministic term order;
- direct links to unchanged blobs and raw runtime artifacts.

An older runtime that does not publish a standalone certification record is represented as “not provided by runtime.” The adapter does not infer or promote certification.

## Verification gates

`npm test` performs:

1. publication assembly;
2. byte-for-byte runtime copy verification;
3. required static-product verification;
4. authority-boundary and no-SPA checks;
5. source coverage and exact blob-text comparison;
6. chunk, graph, and lexical pagination coverage;
7. fact and count reconciliation against raw runtime products;
8. deterministic filename collision checks;
9. configured page-bound enforcement;
10. root discovery and landing-link verification;
11. a second complete assembly and derived-product hash comparison; and
12. an HTTP-only acceptance traversal with no JavaScript.

The acceptance traversal begins at `/`, discovers BUILD-015, follows the publication landing page to the AI index, opens the source directory, opens one source, follows its chunk and unchanged blob links, and retrieves validation, certification, manifest, and catalog records.

## Local verified result

- Runtime files preserved: 106.
- Runtime input bytes preserved: 3,776,834 in the Windows working tree.
- HTML adapter products: 9.
- AI Level 1 products: 388.
- Sources represented exactly once: 80 across three publications.
- Chunks represented in stable pages: 151 across three publications.
- Derived products compared across repeated assembly: 403.
- Repeated-assembly differences: 0.
- HTTP-only acceptance path: PASS.

Production URL and canonical Git-object byte verification are recorded in the final MISSION-133 deployment report after deployment.
