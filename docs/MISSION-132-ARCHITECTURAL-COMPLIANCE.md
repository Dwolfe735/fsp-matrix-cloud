# MISSION-132 — Publication Bridge HTML Runtime Explorer Compliance

## Outcome

The HTML Runtime Explorer is implemented as a post-publication adapter. It consumes repository-held MKC publications through their public runtime contract and writes derived products only beneath each destination publication's `_bridge/html/` namespace.

## Constitutional boundary

- Compiler source is not imported, invoked, or modified.
- Compiler outputs are opened for reading only.
- Every runtime file is copied to the destination and verified by byte length and SHA-256.
- HTML, CSS, and JavaScript products are generated outside the runtime source directories.
- Adapter products do not participate in MKC build identity, certification, validation, or provenance.
- Runtime authority remains in the artifacts linked by the explorer.

## Destination layout

Each destination publication preserves its existing runtime paths and adds a derived adapter namespace:

```text
<publication>/
├── manifest.json
├── catalog.json
├── chunks.jsonl
├── corpus.jsonl
├── graph.json
├── lexical-index.json
├── validation.json
├── merged-document-certification.json
├── merged-documents/
├── blobs/
├── index.html                 # destination landing page
└── _bridge/html/              # non-authoritative derived representation
    ├── index.html
    ├── explorer.css
    └── explorer.js
```

The existing runtime URL contract is unchanged.

## Runtime exposure

The explorer provides views for:

- publication statistics;
- manifest and primary outputs;
- catalog navigation and source-to-chunk routing;
- graph nodes and evidence-bearing edges;
- lexical term lookup and positional postings;
- paginated chunk contexts and semantic addresses;
- corpus records;
- content-addressed blob links;
- validation state;
- merged-document certification; and
- certified merged documents.

Each view supplies a raw-artifact link or an identity/hash-based link back to the underlying runtime product.

## Compatibility

The adapter operates against the published schema fields and tolerates publications without the newer standalone merged-document certification product. Existing publication directories require no regeneration and receive no source modifications.

## Verification contract

`scripts/verify-publication-bridge.mjs` independently checks:

1. every source runtime file exists in the destination;
2. source and destination byte length and SHA-256 match;
3. adapter products exist only under `_bridge/html/`;
4. every publication landing page links to its explorer;
5. the explorer discloses its derived and non-authoritative status; and
6. explorer code exposes traceable access to every required runtime product class.

Run the complete gate with:

```text
npm test
```

The gate rebuilds the destination assembly and then verifies runtime fidelity, adapter isolation, discovery, and traceability.

